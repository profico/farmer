/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";

import {
	isReloadPending,
	isStaleChunkError,
	RELOAD_WINDOW_MS,
	reloadIfStaleChunk,
	claimStaleChunkFault,
	sendStaleChunkReports,
	takeStaleChunkReports,
	type ReloadEnv,
} from "./stale-chunk.ts";

const CSS = "Unable to preload CSS for /assets/route-AbCdEf12.css";
const ROUTER_KEY = "tanstack_router_reload:";

const CHROME =
	"Failed to fetch dynamically imported module: https://farmer.profi.co/assets/_orgSlug-BlkH4Rvi.js";

/** A Storage stand-in that keeps its values in a Map. */
const memoryStorage = () => {
	const values = new Map<string, string>();
	return {
		values,
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => void values.set(key, value),
		removeItem: (key: string) => void values.delete(key),
		key: (index: number) => [...values.keys()][index] ?? null,
		get length() {
			return values.size;
		},
	};
};

/** A storage whose reads and writes can throw. */
const brokenStorage = (broken: "read" | "write") => ({
	getItem: () => {
		if (broken === "read") throw new Error("denied");
		return null;
	},
	setItem: () => {
		if (broken === "write") throw new Error("quota");
	},
	removeItem: () => {},
	key: () => null,
	length: 0,
});

/** The same storage and clock in a new page: the old page has unloaded. */
const nextPage = (env: ReloadEnv): ReloadEnv => ({ ...env });

/** An env with a clock the test moves and a count of reload calls. */
const makeEnv = (overrides: Partial<ReloadEnv> = {}) => {
	const storage = memoryStorage();
	const state = { now: 1_000_000, reloads: 0 };
	const env: ReloadEnv = {
		storage,
		now: () => state.now,
		reload: () => {
			state.reloads += 1;
		},
		...overrides,
	};
	return { env, storage, state };
};

describe("isStaleChunkError", () => {
	test("accepts the Chrome, Firefox and Safari messages", () => {
		expect(isStaleChunkError(new TypeError(CHROME))).toBe(true);
		expect(
			isStaleChunkError(
				new TypeError(
					"error loading dynamically imported module: https://x/assets/a-12345678.js",
				),
			),
		).toBe(true);
		expect(
			isStaleChunkError(new TypeError("Importing a module script failed.")),
		).toBe(true);
	});

	test("accepts the Vite stylesheet preload failure", () => {
		expect(
			isStaleChunkError(
				new Error("Unable to preload CSS for /assets/route-AbCdEf12.css"),
			),
		).toBe(true);
	});

	test("accepts a plain object with a message", () => {
		expect(isStaleChunkError({ message: CHROME })).toBe(true);
	});

	test("rejects other errors and non-errors", () => {
		expect(isStaleChunkError(new Error("Network request failed"))).toBe(false);
		expect(isStaleChunkError(new TypeError("x is not a function"))).toBe(false);
		expect(isStaleChunkError(null)).toBe(false);
		expect(isStaleChunkError(undefined)).toBe(false);
		expect(isStaleChunkError({})).toBe(false);
	});

	test("rejects a message that only mentions the phrase later", () => {
		expect(
			isStaleChunkError(
				new Error("Wrapped: Failed to fetch dynamically imported module"),
			),
		).toBe(false);
	});
});

describe("reloadIfStaleChunk", () => {
	test("reloads once for a stale chunk error", () => {
		const { env, state } = makeEnv();
		expect(reloadIfStaleChunk(new TypeError(CHROME), env)).toBe(true);
		expect(state.reloads).toBe(1);
	});

	test("does not reload for an unrelated error", () => {
		const { env, state, storage } = makeEnv();
		expect(reloadIfStaleChunk(new Error("boom"), env)).toBe(false);
		expect(state.reloads).toBe(0);
		expect(storage.values.size).toBe(0);
	});

	test("does not reload a second time inside the window", () => {
		const { env, state } = makeEnv();
		expect(reloadIfStaleChunk(new TypeError(CHROME), env)).toBe(true);
		state.now += RELOAD_WINDOW_MS - 1;
		expect(reloadIfStaleChunk(new TypeError(CHROME), nextPage(env))).toBe(
			false,
		);
		expect(state.reloads).toBe(1);
	});

	test("a different chunk in the same page is handled, not reloaded", () => {
		const { env, state } = makeEnv();
		expect(isReloadPending(env)).toBe(false);
		reloadIfStaleChunk(new TypeError(CHROME), env);
		expect(isReloadPending(env)).toBe(true);
		const other = new TypeError(CHROME.replace("_orgSlug", "route"));
		expect(reloadIfStaleChunk(other, env)).toBe(true);
		expect(state.reloads).toBe(1);
	});

	test("a new page inside the window does not reload", () => {
		const { env, storage, state } = makeEnv();
		reloadIfStaleChunk(new TypeError(CHROME), env);
		const fresh = nextPage(env);
		expect(reloadIfStaleChunk(new TypeError(CHROME), fresh)).toBe(false);
		expect(isReloadPending(fresh)).toBe(false);
		expect(state.reloads).toBe(1);
		expect(storage.values.size).toBeGreaterThan(0);
	});

	test("reloads again once the window has passed", () => {
		const { env, state } = makeEnv();
		reloadIfStaleChunk(new TypeError(CHROME), env);
		state.now += RELOAD_WINDOW_MS;
		expect(reloadIfStaleChunk(new TypeError(CHROME), nextPage(env))).toBe(true);
		expect(state.reloads).toBe(2);
	});

	test("a stamp from the future does not block a reload", () => {
		const { env, storage, state } = makeEnv();
		storage.setItem(
			"farmer-stale-chunk-reload",
			String(state.now + 10_000_000),
		);
		expect(reloadIfStaleChunk(new TypeError(CHROME), env)).toBe(true);
	});

	test("a corrupt stamp does not block a reload", () => {
		const { env, storage } = makeEnv();
		storage.setItem("farmer-stale-chunk-reload", "not a number");
		expect(reloadIfStaleChunk(new TypeError(CHROME), env)).toBe(true);
	});

	test("does not reload when there is no storage", () => {
		const { env, state } = makeEnv({ storage: undefined });
		expect(reloadIfStaleChunk(new TypeError(CHROME), env)).toBe(false);
		expect(state.reloads).toBe(0);
	});

	test("does not reload when storage throws on read", () => {
		const { env, state } = makeEnv({ storage: brokenStorage("read") });
		expect(reloadIfStaleChunk(new TypeError(CHROME), env)).toBe(false);
		expect(state.reloads).toBe(0);
	});

	test("does not reload when storage throws on write", () => {
		const { env, state } = makeEnv({ storage: brokenStorage("write") });
		expect(reloadIfStaleChunk(new TypeError(CHROME), env)).toBe(false);
		expect(state.reloads).toBe(0);
	});
});

describe("reloadIfStaleChunk after TanStack", () => {
	test("does not reload when TanStack already reloaded for the message", () => {
		const { env, state, storage } = makeEnv();
		storage.setItem(`${ROUTER_KEY}${CHROME}`, "1");
		expect(reloadIfStaleChunk(new TypeError(CHROME), env)).toBe(false);
		expect(state.reloads).toBe(0);
		expect(isReloadPending(env)).toBe(false);
	});

	test("a TanStack key for another message does not block", () => {
		const { env, state, storage } = makeEnv();
		storage.setItem(`${ROUTER_KEY}${CHROME.replace("_orgSlug", "x")}`, "1");
		expect(reloadIfStaleChunk(new TypeError(CHROME), env)).toBe(true);
		expect(state.reloads).toBe(1);
	});

	test("the stylesheet failure reloads once per window", () => {
		const { env, state } = makeEnv();
		expect(reloadIfStaleChunk(new Error(CSS), env)).toBe(true);
		state.now += RELOAD_WINDOW_MS - 1;
		expect(reloadIfStaleChunk(new Error(CSS), nextPage(env))).toBe(false);
		state.now += 1;
		expect(reloadIfStaleChunk(new Error(CSS), nextPage(env))).toBe(true);
		expect(state.reloads).toBe(2);
	});
});

describe("claimStaleChunkFault", () => {
	test("claims a stale chunk message once", () => {
		const message = `${CHROME}?claim`;
		expect(claimStaleChunkFault(new TypeError(message))).toBe(true);
		expect(claimStaleChunkFault(new TypeError(message))).toBe(false);
	});

	test("always claims another error", () => {
		const error = new Error("boom");
		expect(claimStaleChunkFault(error)).toBe(true);
		expect(claimStaleChunkFault(error)).toBe(true);
	});
});

describe("takeStaleChunkReports", () => {
	test("reports each TanStack reload once and keeps its key", () => {
		const { storage } = makeEnv();
		storage.setItem(`${ROUTER_KEY}${CHROME}`, "1");
		expect(takeStaleChunkReports(storage)).toEqual([
			{ message: CHROME, source: "router" },
		]);
		expect(takeStaleChunkReports(storage)).toEqual([]);
		expect(storage.getItem(`${ROUTER_KEY}${CHROME}`)).toBe("1");
		storage.setItem(`${ROUTER_KEY}other`, "1");
		expect(takeStaleChunkReports(storage)).toEqual([
			{ message: "other", source: "router" },
		]);
	});

	test("reports the error screen reload and the router reload", () => {
		const { env, storage } = makeEnv();
		reloadIfStaleChunk(new Error(CSS), env);
		storage.setItem(`${ROUTER_KEY}${CHROME}`, "1");
		expect(takeStaleChunkReports(storage)).toEqual([
			{ message: CSS, source: "error-screen" },
			{ message: CHROME, source: "router" },
		]);
	});

	test("ignores a corrupt reported list", () => {
		const { storage } = makeEnv();
		storage.setItem("farmer-stale-chunk-router-reported", "{not json");
		storage.setItem(`${ROUTER_KEY}${CHROME}`, "1");
		expect(takeStaleChunkReports(storage)).toEqual([]);
		storage.setItem("farmer-stale-chunk-router-reported", '{"a":1}');
		expect(takeStaleChunkReports(storage)).toEqual([
			{ message: CHROME, source: "router" },
		]);
	});
});

describe("takeStaleChunkReport (error screen)", () => {
	test("returns nothing when no reload happened", () => {
		const { storage } = makeEnv();
		expect(takeStaleChunkReports(storage)).toEqual([]);
	});

	test("returns the failed module once and then clears it", () => {
		const { env, storage } = makeEnv();
		reloadIfStaleChunk(new TypeError(CHROME), env);
		expect(takeStaleChunkReports(storage)).toEqual([
			{ message: CHROME, source: "error-screen" },
		]);
		expect(takeStaleChunkReports(storage)).toEqual([]);
	});

	test("keeps the reload guard after the report is taken", () => {
		const { env, storage, state } = makeEnv();
		reloadIfStaleChunk(new TypeError(CHROME), env);
		takeStaleChunkReports(storage);
		expect(reloadIfStaleChunk(new TypeError(CHROME), nextPage(env))).toBe(
			false,
		);
		expect(state.reloads).toBe(1);
	});

	test("ignores a corrupt report and undefined storage", () => {
		const { storage } = makeEnv();
		storage.setItem("farmer-stale-chunk-report", "{not json");
		expect(takeStaleChunkReports(storage)).toEqual([]);
		expect(takeStaleChunkReports(undefined)).toEqual([]);
	});
});

describe("sendStaleChunkReports", () => {
	test("captures each report as a stale_chunk_reloaded event", () => {
		const { env, storage } = makeEnv();
		reloadIfStaleChunk(new Error(CSS), env);
		storage.setItem(`${ROUTER_KEY}${CHROME}`, "1");
		const events: { event: string; properties: object }[] = [];
		sendStaleChunkReports(
			{ capture: (event, properties) => events.push({ event, properties }) },
			storage,
		);
		expect(events).toEqual([
			{
				event: "stale_chunk_reloaded",
				properties: { message: CSS, source: "error-screen" },
			},
			{
				event: "stale_chunk_reloaded",
				properties: { message: CHROME, source: "router" },
			},
		]);
	});
});
