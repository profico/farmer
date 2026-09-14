/**
 * The one-command CLI install: `curl -fsSL <origin>/cli | sh` on macOS and
 * Linux, `irm <origin>/cli | iex` in Windows PowerShell.
 *
 * Both scripts download from THIS server (`/cli/download/<asset>`), never from
 * GitHub directly. The repository is private, so an anonymous script cannot
 * read its releases; the server holds the token and redirects each download to
 * GitHub's short-lived signed URL (`server/cli-releases.ts`). That also means a
 * deployment installs the binaries its own operator chose to point it at.
 *
 * The scripts are templates over one value, the origin, and it is embedded as a
 * quoted literal in each shell's own quoting rules. It comes from the
 * operator's environment and has been through `URL.origin`, so it cannot hold a
 * quote today — the quoting is there so that stays true if either of those ever
 * changes.
 *
 * No `@farmer/core` import at all, so the routes can import this statically
 * without pulling anything server-only into a bundle.
 */

/** Every file a release carries, and the only names `/cli/download/<asset>`
 *  answers for. The build (`apps/cli`, `bun run build:release`) writes exactly
 *  these; a name added there has to be added here, or the script 404s on it. */
export const CLI_RELEASE_ASSETS = [
	"farmer-linux-x64",
	"farmer-linux-arm64",
	"farmer-linux-x64-musl",
	"farmer-linux-arm64-musl",
	"farmer-darwin-x64",
	"farmer-darwin-arm64",
	"farmer-windows-x64.exe",
	"SHA256SUMS",
] as const;

export type CliReleaseAsset = (typeof CLI_RELEASE_ASSETS)[number];

/**
 * The origin the scripts download from and hand to `farmer login`.
 *
 * `BETTER_AUTH_URL` first, for the reason `getPublicAppConfig` gives: it is the
 * origin the device flow's `verification_uri` is built on, so a CLI logged in
 * against any other hostname would send the person to approve a code on a
 * different one. The request's own origin is the fallback for a deployment
 * that has not set it — behind a proxy that may be an internal address, which
 * is one more reason to set it.
 */
export const installOrigin = (request: Request): string => {
	const configured = URL.parse(process.env.BETTER_AUTH_URL ?? "");
	if (configured && isWebUrl(configured)) return configured.origin;
	return new URL(request.url).origin;
};

const isWebUrl = (url: URL) =>
	url.protocol === "https:" || url.protocol === "http:";

/** A plain-text answer, uncached. Both scripts print a failed download's body,
 *  so every non-redirect answer on these routes is a sentence for a person.
 *
 *  `nosniff`, because the download route's 404 repeats the requested name back:
 *  a browser allowed to sniff could decide text containing markup was HTML,
 *  on this app's own origin. */
export const plainText = (
	body: string,
	status = 200,
	headers: Record<string, string> = {},
): Response =>
	new Response(body.endsWith("\n") ? body : `${body}\n`, {
		status,
		headers: {
			"Content-Type": "text/plain; charset=utf-8",
			"Cache-Control": "no-store",
			"X-Content-Type-Options": "nosniff",
			...headers,
		},
	});

/** Windows PowerShell identifies itself as `WindowsPowerShell/5.1`, PowerShell
 *  7 as `PowerShell/7.x`. curl, wget and a browser say neither. */
export const wantsPowerShell = (request: Request): boolean =>
	/PowerShell/i.test(request.headers.get("user-agent") ?? "");

/** A POSIX single-quoted literal: nothing inside is special except the quote,
 *  which closes the literal, adds an escaped quote, and opens a new one. */
const shQuote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

/** A PowerShell single-quoted literal. PowerShell also treats the typographic
 *  single quotes as quote characters, so each of them is doubled too. */
const psQuote = (value: string) =>
	`'${value.replace(/['‘’‚‛]/g, (quote) => quote + quote)}'`;

/**
 * The macOS and Linux installer.
 *
 * Everything is inside `main`, called on the last line, because `curl | sh`
 * executes the script as it arrives: a connection that drops half way through
 * must leave a function that was never called, not half of an install.
 *
 * `farmer login` reads its prompts from `/dev/tty`, because this shell's stdin
 * is the pipe the script came down — without the redirect the prompts would
 * read the rest of the script, or end of file.
 */
export const shInstallScript = (origin: string): string => `#!/bin/sh
# Installs the Farmer command-line tool.
#
#   curl -fsSL ${origin}/cli | sh
#
# FARMER_INSTALL_DIR   where to put the binary (default: $HOME/.local/bin)
# FARMER_NO_LOGIN=1    install only; do not run "farmer login" afterwards
set -eu

FARMER_ORIGIN=${shQuote(origin)}

say() {
	printf '%s\\n' "$*"
}

fail() {
	printf 'farmer install: %s\\n' "$*" >&2
	exit 1
}

is_musl() {
	for loader in /lib/ld-musl-*; do
		if [ -e "$loader" ]; then
			return 0
		fi
	done
	if command -v ldd >/dev/null 2>&1 && ldd --version 2>&1 | grep -qi musl; then
		return 0
	fi
	return 1
}

# Bun's musl runtime links libstdc++ and libgcc dynamically, and Alpine leaves
# both out of its base image. Without them the binary stops with "Error
# relocating ... symbol not found" before it prints a word.
musl_libraries_missing() {
	for lib in libstdc++.so.6 libgcc_s.so.1; do
		if [ ! -e "/usr/lib/$lib" ] && [ ! -e "/lib/$lib" ]; then
			return 0
		fi
	done
	return 1
}

detect_asset() {
	os=$(uname -s)
	arch=$(uname -m)
	case "$arch" in
		x86_64 | amd64) arch=x64 ;;
		arm64 | aarch64) arch=arm64 ;;
		*) fail "this CPU architecture is not supported: $arch" ;;
	esac
	case "$os" in
		Darwin)
			# An x64 shell on Apple silicon runs under Rosetta. The native binary
			# is faster, and it is the one that keeps working without Rosetta.
			if [ "$arch" = x64 ] && [ "$(sysctl -in sysctl.proc_translated 2>/dev/null || true)" = 1 ]; then
				arch=arm64
			fi
			printf 'farmer-darwin-%s' "$arch"
			;;
		Linux)
			if is_musl; then
				printf 'farmer-linux-%s-musl' "$arch"
			else
				printf 'farmer-linux-%s' "$arch"
			fi
			;;
		*) fail "this operating system is not supported: $os (on Windows, run in PowerShell: irm $FARMER_ORIGIN/cli | iex)" ;;
	esac
}

# download URL FILE: a failed answer from the server is a sentence explaining
# why (no GitHub App access, no release yet), so it is shown rather than dropped.
download() {
	if command -v curl >/dev/null 2>&1; then
		status=$(curl -sSL --retry 2 -o "$2" -w '%{http_code}' "$1") || fail "could not download $1"
		case "$status" in
			2??) return 0 ;;
		esac
		printf 'farmer install: the server answered HTTP %s for %s\\n' "$status" "$1" >&2
		if [ -s "$2" ]; then
			cat "$2" >&2
		fi
		exit 1
	elif command -v wget >/dev/null 2>&1; then
		wget -q -O "$2" "$1" || fail "could not download $1"
	else
		fail "curl or wget is required"
	fi
}

sha256_of() {
	if command -v sha256sum >/dev/null 2>&1; then
		sha256sum "$1" | awk '{ print $1 }'
	elif command -v shasum >/dev/null 2>&1; then
		shasum -a 256 "$1" | awk '{ print $1 }'
	else
		return 1
	fi
}

main() {
	asset=$(detect_asset)
	case "$asset" in
		*-musl)
			if musl_libraries_missing; then
				fail "this system needs libstdc++ and libgcc first. On Alpine, run: apk add libstdc++ libgcc"
			fi
			;;
	esac
	install_dir=\${FARMER_INSTALL_DIR:-$HOME/.local/bin}

	tmp=$(mktemp -d "\${TMPDIR:-/tmp}/farmer.XXXXXX")
	trap 'rm -rf "$tmp"' EXIT
	trap 'exit 130' INT TERM

	say "Downloading $asset from $FARMER_ORIGIN"
	download "$FARMER_ORIGIN/cli/download/$asset" "$tmp/$asset"
	download "$FARMER_ORIGIN/cli/download/SHA256SUMS" "$tmp/SHA256SUMS"

	expected=$(awk -v name="$asset" '$2 == name || $2 == "*" name { print $1; exit }' "$tmp/SHA256SUMS" | tr 'A-F' 'a-f')
	if [ -z "$expected" ]; then
		fail "SHA256SUMS has no entry for $asset"
	fi
	if actual=$(sha256_of "$tmp/$asset"); then
		actual=$(printf '%s' "$actual" | tr 'A-F' 'a-f')
		if [ "$actual" != "$expected" ]; then
			fail "checksum mismatch for $asset (expected $expected, got $actual). Nothing was installed."
		fi
	else
		printf 'farmer install: warning: neither sha256sum nor shasum is installed, so the download was NOT verified\\n' >&2
	fi

	mkdir -p "$install_dir"
	chmod +x "$tmp/$asset"
	mv -f "$tmp/$asset" "$install_dir/farmer"
	say "Installed farmer to $install_dir/farmer"

	case ":$PATH:" in
		*":$install_dir:"*)
			farmer_cmd=farmer
			;;
		*)
			farmer_cmd="$install_dir/farmer"
			say ""
			say "$install_dir is not on your PATH. To use \\"farmer\\" in a new terminal:"
			case "$(basename "\${SHELL:-sh}")" in
				zsh) say "  add this line to ~/.zshrc:   export PATH=\\"$install_dir:\\$PATH\\"" ;;
				bash) say "  add this line to ~/.bashrc:  export PATH=\\"$install_dir:\\$PATH\\"" ;;
				fish) say "  run this once:  fish_add_path \\"$install_dir\\"" ;;
				*) say "  add this line to ~/.profile: export PATH=\\"$install_dir:\\$PATH\\"" ;;
			esac
			;;
	esac

	say ""
	if [ "\${FARMER_NO_LOGIN:-}" = 1 ]; then
		say "Sign in with: $farmer_cmd login $FARMER_ORIGIN"
	elif (: </dev/tty) 2>/dev/null; then
		"$install_dir/farmer" login "$FARMER_ORIGIN" </dev/tty
	else
		say "No terminal to sign in from. Run this next: $farmer_cmd login $FARMER_ORIGIN"
	fi
}

main "$@"
`;

/**
 * The Windows installer, for Windows PowerShell 5.1 as well as PowerShell 7 —
 * `irm | iex` runs in whichever one the person opened, and 5.1 is the one every
 * Windows machine has. So: no `??`, no ternary, `-UseBasicParsing`, and TLS 1.2
 * switched on explicitly because 5.1 on an older .NET does not offer it.
 *
 * The body is one script block, `& { ... }`. `iex` runs the text in the
 * person's own session, so a bare `exit` would close their window and every
 * variable would be left behind in it; inside the block, a failure is a
 * `throw` that prints and stops, and nothing leaks out.
 *
 * One binary for every Windows machine: Windows on ARM runs the x64 build under
 * emulation.
 */
export const psInstallScript = (
	origin: string,
): string => `# Installs the Farmer command-line tool.
#
#   irm ${origin}/cli | iex
#
# FARMER_INSTALL_DIR   where to put farmer.exe (default: %LOCALAPPDATA%\\Programs\\farmer)
# FARMER_NO_LOGIN=1    install only; do not run "farmer login" afterwards
& {
	$ErrorActionPreference = 'Stop'
	# The progress bar makes Invoke-WebRequest many times slower on 5.1.
	$ProgressPreference = 'SilentlyContinue'

	$FarmerOrigin = ${psQuote(origin)}
	$Asset = 'farmer-windows-x64.exe'

	try {
		[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
	} catch {
	}

	if ($env:PROCESSOR_ARCHITECTURE -eq 'x86' -and -not $env:PROCESSOR_ARCHITEW6432) {
		throw 'farmer install: 32-bit Windows is not supported.'
	}

	function Get-FarmerFile([string] $Url, [string] $OutFile) {
		try {
			Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing
		} catch {
			# The server explains a refused download (no release token, no release
			# yet) in the body, and ErrorDetails is where both 5.1 and 7 put it.
			$detail = $_.ErrorDetails.Message
			if (-not $detail) {
				$detail = $_.Exception.Message
			}
			throw ('farmer install: could not download ' + $Url + ': ' + $detail)
		}
	}

	if ($env:FARMER_INSTALL_DIR) {
		$installDir = $env:FARMER_INSTALL_DIR
	} else {
		$installDir = Join-Path $env:LOCALAPPDATA 'Programs\\farmer'
	}
	$exe = Join-Path $installDir 'farmer.exe'

	$tmp = Join-Path ([IO.Path]::GetTempPath()) ('farmer-' + [Guid]::NewGuid().ToString('N'))
	New-Item -ItemType Directory -Path $tmp -Force | Out-Null
	try {
		$download = Join-Path $tmp $Asset
		$sums = Join-Path $tmp 'SHA256SUMS'

		Write-Host ('Downloading ' + $Asset + ' from ' + $FarmerOrigin)
		Get-FarmerFile ($FarmerOrigin + '/cli/download/' + $Asset) $download
		Get-FarmerFile ($FarmerOrigin + '/cli/download/SHA256SUMS') $sums

		$expected = $null
		foreach ($line in Get-Content -LiteralPath $sums) {
			$parts = $line.Trim() -split '\\s+', 2
			if ($parts.Count -eq 2 -and $parts[1].TrimStart([char]'*') -eq $Asset) {
				$expected = $parts[0]
				break
			}
		}
		if (-not $expected) {
			throw ('farmer install: SHA256SUMS has no entry for ' + $Asset)
		}
		$actual = (Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash
		# -ne compares strings without regard to case, and the two tools disagree on it.
		if ($actual -ne $expected) {
			throw ('farmer install: checksum mismatch for ' + $Asset + ' (expected ' + $expected + ', got ' + $actual + '). Nothing was installed.')
		}

		New-Item -ItemType Directory -Path $installDir -Force | Out-Null
		Move-Item -LiteralPath $download -Destination $exe -Force
	} finally {
		Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
	}
	Write-Host ('Installed farmer to ' + $exe)

	# The user PATH, so a new terminal finds farmer; then this session's PATH, so
	# the login below and the next command in this window do too. The stored value
	# is read expanded and written back expanded, which keeps every existing entry
	# pointing where it did.
	$target = $installDir.TrimEnd([char]'\\')
	$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
	$entries = @()
	if ($userPath) {
		$entries = @($userPath -split ';' | Where-Object { $_ })
	}
	if (-not ($entries | Where-Object { $_.TrimEnd([char]'\\') -ieq $target })) {
		[Environment]::SetEnvironmentVariable('Path', (($entries + $installDir) -join ';'), 'User')
		Write-Host ('Added ' + $installDir + ' to your user PATH.')
	}
	if (-not (($env:Path -split ';') | Where-Object { $_.TrimEnd([char]'\\') -ieq $target })) {
		$env:Path = $env:Path + ';' + $installDir
	}

	Write-Host ''
	if ($env:FARMER_NO_LOGIN -eq '1') {
		Write-Host ('Sign in with: farmer login ' + $FarmerOrigin)
	} else {
		& $exe login $FarmerOrigin
	}
}
`;
