import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

import { CliError } from "./errors";

export type Paths = { dir: string; config: string; credentials: string };

/**
 * `$XDG_CONFIG_HOME/farmer` (default `~/.config/farmer`) on Linux and macOS,
 * `%APPDATA%\farmer` on Windows. macOS gets the XDG path rather than
 * `~/Library/Application Support` because that is where people who use a
 * terminal look for a CLI's config, and where their dotfiles already sync.
 */
export const configPaths = (
	env: NodeJS.ProcessEnv,
	platform: NodeJS.Platform,
	home: string,
): Paths => {
	const base =
		platform === "win32"
			? env.APPDATA || join(home, "AppData", "Roaming")
			: env.XDG_CONFIG_HOME || join(home, ".config");
	const dir = join(base, "farmer");
	return {
		dir,
		config: join(dir, "config.json"),
		credentials: join(dir, "credentials.json"),
	};
};

// Lists rather than maps keyed by origin or slug: the file is read by a parser
// either way, and a list keeps the parsed value free of index signatures.
const orgEntry = z.object({
	slug: z.string(),
	name: z.string(),
	/** Cached from `whoami`, so a relative date needs no request. */
	timeZone: z.string().nullable(),
	/** Cached from `whoami`, same as `timeZone`. An old config file has no such
	 *  key, so a missing value reads as unset rather than failing to parse. */
	weekStartsOn: z
		.union([z.literal(0), z.literal(1)])
		.nullable()
		.default(null),
});

const serverEntry = z.object({
	origin: z.string(),
	/** The default organization on this server. */
	org: z.string().nullable(),
	orgs: z.array(orgEntry),
});

const configFile = z.object({
	lastServer: z.string().nullable(),
	servers: z.array(serverEntry),
});

export type OrgEntry = z.infer<typeof orgEntry>;
export type ServerEntry = z.infer<typeof serverEntry>;
export type Config = z.infer<typeof configFile>;

export const configExists = (paths: Paths) => Bun.file(paths.config).exists();

export const readConfig = async (paths: Paths): Promise<Config> => {
	const file = Bun.file(paths.config);
	if (!(await file.exists())) return { lastServer: null, servers: [] };
	const invalid = new CliError(
		`${paths.config} is not a valid Farmer config. Delete it and run \`farmer login\` again.`,
	);
	let raw: string;
	try {
		raw = await file.text();
	} catch {
		throw invalid;
	}
	let parsed: ReturnType<typeof configFile.safeParse>;
	try {
		parsed = configFile.safeParse(JSON.parse(raw));
	} catch {
		throw invalid;
	}
	if (!parsed.success) throw invalid;
	return parsed.data;
};

export const writeConfig = async (paths: Paths, config: Config) => {
	await mkdir(paths.dir, { recursive: true, mode: 0o700 });
	await Bun.write(paths.config, `${JSON.stringify(config, null, "\t")}\n`);
};

/** The entry for `origin`, added to `config` when it has none yet. */
export const serverEntryFor = (config: Config, origin: string): ServerEntry => {
	const found = config.servers.find((server) => server.origin === origin);
	if (found) return found;
	const created: ServerEntry = { origin, org: null, orgs: [] };
	config.servers.push(created);
	return created;
};
