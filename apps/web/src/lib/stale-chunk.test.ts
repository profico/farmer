/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";

import {
	installStaleChunkHandler,
	isStaleChunkError,
	RELOAD_WINDOW_MS,
	reloadIfStaleChunk,
	takeStaleChunkReport,
	type ReloadEnv,
	type Thrown,
} from "./stale-chunk.ts";

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
	};
};

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
		expect(reloadIfStaleChunk(new TypeError(CHROME), env)).toBe(false);
		expect(state.reloads).toBe(1);
	});

	test("a different chunk inside the window does not reload either", () => {
		const { env, state } = makeEnv();
		reloadIfStaleChunk(new TypeError(CHROME), env);
		const other = new TypeError(CHROME.replace("_orgSlug", "route"));
		expect(reloadIfStaleChunk(other, env)).toBe(false);
		expect(state.reloads).toBe(1);
	});

	test("reloads again once the window has passed", () => {
		const { env, state } = makeEnv();
		reloadIfStaleChunk(new TypeError(CHROME), env);
		state.now += RELOAD_WINDOW_MS;
		expect(reloadIfStaleChunk(new TypeError(CHROME), env)).toBe(true);
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
		const { env, state } = makeEnv({
			storage: {
				getItem: () => {
					throw new Error("denied");
				},
				setItem: () => {},
				removeItem: () => {},
			},
		});
		expect(reloadIfStaleChunk(new TypeError(CHROME), env)).toBe(false);
		expect(state.reloads).toBe(0);
	});

	test("does not reload when storage throws on write", () => {
		const { env, state } = makeEnv({
			storage: {
				getItem: () => null,
				setItem: () => {
					throw new Error("quota");
				},
				removeItem: () => {},
			},
		});
		expect(reloadIfStaleChunk(new TypeError(CHROME), env)).toBe(false);
		expect(state.reloads).toBe(0);
	});
});

describe("takeStaleChunkReport", () => {
	test("returns nothing when no reload happened", () => {
		const { storage } = makeEnv();
		expect(takeStaleChunkReport(storage)).toBeUndefined();
	});

	test("returns the failed module once and then clears it", () => {
		const { env, storage } = makeEnv();
		reloadIfStaleChunk(new TypeError(CHROME), env);
		expect(takeStaleChunkReport(storage)).toEqual({ message: CHROME });
		expect(takeStaleChunkReport(storage)).toBeUndefined();
	});

	test("keeps the reload guard after the report is taken", () => {
		const { env, storage, state } = makeEnv();
		reloadIfStaleChunk(new TypeError(CHROME), env);
		takeStaleChunkReport(storage);
		expect(reloadIfStaleChunk(new TypeError(CHROME), env)).toBe(false);
		expect(state.reloads).toBe(1);
	});

	test("ignores a corrupt report and undefined storage", () => {
		const { storage } = makeEnv();
		storage.setItem("farmer-stale-chunk-report", "{not json");
		expect(takeStaleChunkReport(storage)).toBeUndefined();
		expect(takeStaleChunkReport(undefined)).toBeUndefined();
	});
});

describe("installStaleChunkHandler", () => {
	/** A target that records its listener and fires events at it. */
	const fakeTarget = () => {
		let listener: ((event: PreloadEvent) => void) | undefined;
		return {
			addEventListener: (name: string, fn: (event: PreloadEvent) => void) => {
				expect(name).toBe("vite:preloadError");
				listener = fn;
			},
			fire: (payload: Thrown) => {
				const event: PreloadEvent = {
					payload,
					prevented: false,
					preventDefault() {
						this.prevented = true;
					},
				};
				listener?.(event);
				return event;
			},
		};
	};
	type PreloadEvent = {
		payload: Thrown;
		prevented: boolean;
		preventDefault: () => void;
	};

	test("reloads and suppresses the throw for a stale chunk", () => {
		const { env, state } = makeEnv();
		const target = fakeTarget();
		installStaleChunkHandler(target, env);
		const event = target.fire(new TypeError(CHROME));
		expect(state.reloads).toBe(1);
		expect(event.prevented).toBe(true);
	});

	test("lets the error through when the guard blocks the reload", () => {
		const { env, state } = makeEnv();
		const target = fakeTarget();
		installStaleChunkHandler(target, env);
		target.fire(new TypeError(CHROME));
		const second = target.fire(new TypeError(CHROME));
		expect(state.reloads).toBe(1);
		expect(second.prevented).toBe(false);
	});

	test("ignores a payload that is not a stale chunk error", () => {
		const { env, state } = makeEnv();
		const target = fakeTarget();
		installStaleChunkHandler(target, env);
		const event = target.fire(new Error("boom"));
		expect(state.reloads).toBe(0);
		expect(event.prevented).toBe(false);
	});
});
