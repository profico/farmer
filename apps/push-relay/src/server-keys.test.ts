import { describe, expect, test } from "bun:test";

import { z } from "zod";

import { runAdmin } from "./admin-cli";
import { createRelay } from "./app";
import { dryRunSender } from "./delivery/dry-run";
import { createLimiters, DEFAULT_LIMITS } from "./rate-limit";
import { DeviceStore, monthOf } from "./store";

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

const NOV_1 = Date.UTC(2026, 10, 1, 0, 0, 0);
const IOS_TOKEN = "a".repeat(64);

const setup = (requireServerKey: boolean) => {
	const store = DeviceStore.open(":memory:");
	let clock = NOV_1 + 3_600_000;
	const logs: string[] = [];
	const relay = createRelay({
		store,
		senders: { ios: dryRunSender(() => {}), android: dryRunSender(() => {}) },
		limiters: createLimiters(DEFAULT_LIMITS),
		trustedIpHeader: null,
		maxDevices: 100,
		requireServerKey,
		log: (line) => logs.push(line),
		now: () => clock,
	});
	const post = (path: string, body: Json, key?: string) => {
		const headers = new Headers({ "content-type": "application/json" });
		if (key) headers.set("authorization", `Bearer ${key}`);
		return relay(
			new Request(`http://relay.test${path}`, {
				method: "POST",
				headers,
				body: JSON.stringify(body),
			}),
			"10.0.0.1",
		);
	};
	const registered = async () => {
		const response = await post("/v1/devices", {
			platform: "ios",
			pushToken: IOS_TOKEN,
		});
		return z.object({ relayId: z.string() }).parse(await response.json())
			.relayId;
	};
	const mint = (limit: number) => {
		const out = runAdmin(
			[
				"keys",
				"create",
				"--label",
				"Example Org",
				"--contact",
				"person@example.com",
				"--monthly-limit",
				String(limit),
			],
			store,
			clock,
		);
		const id = /^id: (\S+)$/.exec(out[0] ?? "")?.[1] ?? "";
		const key = /^key: (\S+)$/.exec(out[1] ?? "")?.[1] ?? "";
		return { id, key };
	};
	return {
		store,
		logs,
		post,
		registered,
		mint,
		advance: (ms: number) => {
			clock += ms;
		},
	};
};

const push = (relayId: string) => ({
	relayId,
	kind: "alert",
	ciphertext: "c".repeat(100),
});

const codeOf = async (response: Response) =>
	z.object({ error: z.string() }).parse(await response.json()).error;

describe("server key on POST /v1/push", () => {
	test("a good key is accepted and the relay stores only its hash", async () => {
		const { post, registered, mint, store } = setup(true);
		const { id, key } = mint(10);
		const relayId = await registered();

		expect((await post("/v1/push", push(relayId), key)).status).toBe(202);
		expect(store.usage(id, NOV_1)).toBe(1);
		expect(JSON.stringify(store.listServerKeys())).not.toContain(
			key.split(".")[1] ?? "x",
		);
	});

	test("a bad key is refused, also when the flag is off", async () => {
		for (const required of [true, false]) {
			const { post, registered, mint } = setup(required);
			const { id, key } = mint(10);
			const relayId = await registered();
			for (const bad of [`${id}.wrong`, "unknown.secret", "nodot", `${key}x`]) {
				const response = await post("/v1/push", push(relayId), bad);
				expect(response.status).toBe(401);
				expect(await codeOf(response)).toBe("invalid_server_key");
			}
		}
	});

	test("a revoked key is refused with 403", async () => {
		const { post, registered, mint, store } = setup(false);
		const { id, key } = mint(10);
		const relayId = await registered();
		runAdmin(["keys", "revoke", id], store, NOV_1);

		const response = await post("/v1/push", push(relayId), key);
		expect(response.status).toBe(403);
		expect(await codeOf(response)).toBe("server_key_revoked");
	});

	test("no key: refused when the flag is on, anonymous when it is off", async () => {
		const on = setup(true);
		const relayId = await on.registered();
		const refused = await on.post("/v1/push", push(relayId));
		expect(refused.status).toBe(401);
		expect(await codeOf(refused)).toBe("server_key_required");

		const off = setup(false);
		const offId = await off.registered();
		expect((await off.post("/v1/push", push(offId))).status).toBe(202);
		expect(off.store.usage("anonymous", NOV_1)).toBe(1);
	});

	test("devices register without a key even when the flag is on", async () => {
		const { registered } = setup(true);
		expect(await registered()).not.toBe("");
	});
});

describe("monthly quota", () => {
	test("the push past the limit gets 429 and does not count", async () => {
		const { post, registered, mint, store } = setup(true);
		const { id, key } = mint(2);
		const relayId = await registered();

		expect((await post("/v1/push", push(relayId), key)).status).toBe(202);
		expect((await post("/v1/push", push(relayId), key)).status).toBe(202);
		const over = await post("/v1/push", push(relayId), key);
		expect(over.status).toBe(429);
		expect(await codeOf(over)).toBe("monthly_quota_exceeded");
		expect(Number(over.headers.get("retry-after"))).toBeGreaterThan(0);
		expect(store.usage(id, NOV_1)).toBe(2);
	});

	test("the count resets in the next UTC month", async () => {
		const { post, registered, mint, store, advance } = setup(true);
		const { id, key } = mint(1);
		const relayId = await registered();
		await post("/v1/push", push(relayId), key);
		expect((await post("/v1/push", push(relayId), key)).status).toBe(429);

		advance(Date.UTC(2026, 11, 1) - NOV_1);
		expect(monthOf(Date.UTC(2026, 11, 1))).toBe("2026-12");
		expect((await post("/v1/push", push(relayId), key)).status).toBe(202);
		expect(store.usage(id, Date.UTC(2026, 10, 15))).toBe(1);
	});

	test("a limit of 0 refuses every push, and set-limit raises it", async () => {
		const { post, registered, mint, store } = setup(true);
		const { id, key } = mint(0);
		const relayId = await registered();
		expect((await post("/v1/push", push(relayId), key)).status).toBe(429);

		runAdmin(["keys", "set-limit", id, "5"], store, NOV_1);
		expect((await post("/v1/push", push(relayId), key)).status).toBe(202);
	});

	test("a refused push (unknown relay id) does not use the quota", async () => {
		const { post, mint, store } = setup(true);
		const { id, key } = mint(5);
		const response = await post("/v1/push", push("nope".repeat(6)), key);
		expect(response.status).toBe(404);
		expect(store.usage(id, NOV_1)).toBe(0);
	});
});

describe("admin commands", () => {
	test("list shows usage, and a bad command throws", async () => {
		const { mint, store } = setup(true);
		const { id } = mint(7);
		expect(runAdmin(["keys", "list"], store, NOV_1)[0]).toContain(
			`${id}  active   0/7 this month  Example Org <person@example.com>`,
		);
		expect(() => runAdmin(["keys", "revoke", "nope"], store, NOV_1)).toThrow(
			"No server key",
		);
		expect(() =>
			runAdmin(["keys", "create", "--label", "x"], store, NOV_1),
		).toThrow("--contact");
		expect(() =>
			runAdmin(["keys", "set-limit", id, "-1"], store, NOV_1),
		).toThrow("whole number");
	});
});
