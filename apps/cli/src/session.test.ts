// `FARMER_TOKEN`: an API token for a script, in place of `farmer login`.
//
// What is pinned is that the environment token wins over the stored login,
// that a refused one never deletes that login, and that a script's session
// leaves the person's config as it found it.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { configPaths, readConfig, writeConfig } from "./config";
import type { Keyring } from "./credentials";
import { createOutput } from "./output";
import type { Runtime } from "./runtime";
import {
	connect,
	credentialStoreFor,
	refreshOrganizations,
	saveConfig,
} from "./session";
import { jsonReply, scriptedServer } from "./test-server";

const ORIGIN = "https://farmer.test";
const API_TOKEN = "fmr_script-token";

let home: string;

beforeAll(async () => {
	home = await mkdtemp(join(tmpdir(), "farmer-session-"));
});

afterAll(async () => {
	await rm(home, { recursive: true, force: true });
});

const memoryKeyring = (): Keyring => {
	const tokens = new Map<string, string>();
	return {
		get: async (origin) => tokens.get(origin) ?? null,
		set: async (origin, token) => {
			tokens.set(origin, token);
		},
		delete: async (origin) => {
			tokens.delete(origin);
		},
	};
};

const runtimeWith = async (
	name: string,
	env: NodeJS.ProcessEnv,
	replies: Response[],
) => {
	const server = scriptedServer(replies);
	const paths = configPaths(
		{ XDG_CONFIG_HOME: join(home, name) },
		"linux",
		home,
	);
	const runtime: Runtime = {
		env,
		platform: "linux",
		arch: "x64",
		paths,
		cwd: home,
		keyring: memoryKeyring(),
		fetch: server.transport.fetch,
		sleep: server.transport.sleep,
		now: () => new Date("2026-09-01T09:00:00Z"),
		executable: null,
		spawn: async () => ({ exitCode: 0, stdout: "" }),
	};
	const config = await readConfig(paths);
	config.lastServer = ORIGIN;
	config.servers = [
		{
			origin: ORIGIN,
			org: "acme",
			orgs: [
				{ slug: "acme", name: "Acme", timeZone: null, weekStartsOn: null },
				{ slug: "beta", name: "Beta", timeZone: null, weekStartsOn: null },
			],
		},
	];
	await writeConfig(paths, config);
	await credentialStoreFor(runtime).set(ORIGIN, "session-token");
	return { runtime, requests: server.requests };
};

const out = () => createOutput(false, {});

const me = (slugs: string[]) =>
	jsonReply(200, {
		user: { id: "u", name: "Ana", email: "ana@example.com" },
		organizations: slugs.map((slug) => ({ slug, name: slug })),
	});

describe("FARMER_TOKEN", () => {
	test("wins over the stored login", async () => {
		const { runtime, requests } = await runtimeWith(
			"wins",
			{ FARMER_TOKEN: API_TOKEN },
			[me(["acme"])],
		);
		const session = await connect(runtime, out());
		expect(session.fromEnvironment).toBe(true);
		await session.api.get("/api/v1/me");
		expect(requests[0]?.headers.get("authorization")).toBe(
			`Bearer ${API_TOKEN}`,
		);
	});

	test("needs a server when there is no stored one", async () => {
		const { runtime } = await runtimeWith(
			"no-server",
			{ FARMER_TOKEN: API_TOKEN },
			[],
		);
		const config = await readConfig(runtime.paths);
		config.lastServer = null;
		await writeConfig(runtime.paths, config);
		await expect(connect(runtime, out())).rejects.toThrow("FARMER_URL");
	});

	test("a refused token names FARMER_TOKEN and keeps the stored login", async () => {
		const { runtime } = await runtimeWith(
			"refused",
			{ FARMER_TOKEN: API_TOKEN },
			[jsonReply(401, { error: "Unauthorized", code: "unauthorized" })],
		);
		const session = await connect(runtime, out());
		await expect(session.api.get("/api/v1/me")).rejects.toThrow("FARMER_TOKEN");
		expect(await credentialStoreFor(runtime).get(ORIGIN)).toBe("session-token");
	});

	test("leaves the cached organizations and the default alone", async () => {
		const { runtime } = await runtimeWith(
			"config",
			{ FARMER_TOKEN: API_TOKEN },
			[me(["beta"])],
		);
		const session = await connect(runtime, out());
		await refreshOrganizations(session);
		await saveConfig(session);

		const saved = await readConfig(runtime.paths);
		const entry = saved.servers.find((server) => server.origin === ORIGIN);
		expect(entry?.org).toBe("acme");
		expect(entry?.orgs.map((org) => org.slug)).toEqual(["acme", "beta"]);
	});

	test("an empty value is no token", async () => {
		const { runtime } = await runtimeWith("empty", { FARMER_TOKEN: " " }, []);
		const session = await connect(runtime, out());
		expect(session.fromEnvironment).toBe(false);
	});
});
