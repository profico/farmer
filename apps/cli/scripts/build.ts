/**
 * Compiles the CLI into standalone binaries.
 *
 *   bun run build            dist/farmer, for this machine
 *   bun run build:release    dist/release/, one binary per platform and
 *                            SHA256SUMS
 *
 * The release asset names are a contract with the release workflow and the
 * install script served at `/cli`, which download them by name. Rename one
 * here and both break.
 */

import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

import { $ } from "bun";

const root = join(import.meta.dir, "..");
const entry = join(root, "src", "main.ts");

// x64 uses the baseline runtime everywhere. The default x64 runtime needs AVX2
// and dies with "Illegal instruction" on an older CPU, and a cross-compiled
// binary cannot find out in advance which CPU it will meet. arm64 has no
// baseline variant.
//
// The two darwin binaries built on Linux do not run on macOS as they come out:
// their code signature does not match the file, and Apple silicon kills them.
// The release workflow re-signs them on a Mac before anything ships (see the
// note on that step in `.github/workflows/cli-release.yml`), which is also why
// it writes SHA256SUMS again rather than using the one written here.
const RELEASE_TARGETS = [
	{ asset: "farmer-linux-x64", target: "bun-linux-x64-baseline" },
	{ asset: "farmer-linux-arm64", target: "bun-linux-arm64" },
	{ asset: "farmer-linux-x64-musl", target: "bun-linux-x64-musl-baseline" },
	{ asset: "farmer-linux-arm64-musl", target: "bun-linux-arm64-musl" },
	{ asset: "farmer-darwin-x64", target: "bun-darwin-x64-baseline" },
	{ asset: "farmer-darwin-arm64", target: "bun-darwin-arm64" },
	{ asset: "farmer-windows-x64.exe", target: "bun-windows-x64-baseline" },
];

const compile = async (outfile: string, target: string | null) => {
	const targetFlag = target ? [`--target=${target}`] : [];
	// A compiled Bun binary reads `.env` and `bunfig.toml` from the directory it
	// runs in unless told not to. For a CLI that directory is somebody's project,
	// whose `.env` could set FARMER_URL without the person knowing.
	await $`bun build ${entry} --compile --minify ${targetFlag} --no-compile-autoload-dotenv --no-compile-autoload-bunfig --outfile ${outfile}`.cwd(
		root,
	);
};

const sha256 = async (path: string) =>
	new Bun.CryptoHasher("sha256")
		.update(await Bun.file(path).arrayBuffer())
		.digest("hex");

if (Bun.argv.includes("--release")) {
	const dir = join(root, "dist", "release");
	// Emptied first, so the directory holds exactly this build's assets.
	await rm(dir, { recursive: true, force: true });
	await mkdir(dir, { recursive: true });
	const sums: string[] = [];
	for (const { asset, target } of RELEASE_TARGETS) {
		const outfile = join(dir, asset);
		await compile(outfile, target);
		sums.push(`${await sha256(outfile)}  ${asset}`);
	}
	await Bun.write(join(dir, "SHA256SUMS"), `${sums.join("\n")}\n`);
	console.log(
		`Wrote ${RELEASE_TARGETS.length} binaries and SHA256SUMS to ${dir}`,
	);
} else {
	await compile(join(root, "dist", "farmer"), null);
}
