// The order of timer pushes. FCM does not keep the order of data messages,
// so the app must drop a timer push that is older than the last one that it
// applied. The native modules are fakes: the test records each applied push.

import { beforeEach, describe, expect, mock, test } from "bun:test";

const items = new Map<string, string>();
const applied: string[] = [];
let opened = "";

mock.module("expo-notifications", () => ({
	AndroidImportance: { DEFAULT: 3 },
	setNotificationChannelAsync: async () => undefined,
	scheduleNotificationAsync: async () => undefined,
}));
mock.module("expo-sqlite/kv-store", () => ({
	default: {
		getItemSync: (key: string) => items.get(key) ?? null,
		setItemSync: (key: string, value: string) => {
			items.set(key, value);
		},
	},
}));
mock.module("react-native", () => ({ Platform: { OS: "android" } }));
mock.module("./keys", () => ({ openPush: async () => opened }));
mock.module("./timer-surface", () => ({
	clearTimerSurface: () => {
		applied.push("end");
	},
	showTimerSurface: (surface: { state?: string }) => {
		applied.push(String(surface.state));
	},
	surfaceOfPush: (state: { state: string }) => ({ state: state.state }),
}));

const { handleSealedPush } = await import("./receive");

const NOW = Date.now();
let counter = 0;

/** A sealed timer push, as the server writes it. */
const timerPush = async (
	state: "running" | "held",
	sentAt: number,
): Promise<void> => {
	counter += 1;
	opened = JSON.stringify({
		kind: "timer",
		event: "update",
		workspace: "acme",
		project: null,
		task: "Work",
		state: {
			state,
			runningSinceMs: state === "running" ? sentAt : null,
			accumulatedSeconds: 0,
		},
		pushKind: "data",
		sentAt,
		id: `id-${counter}`,
	});
	await handleSealedPush({ sealed: "x", kind: "data" });
};

describe("timer push order", () => {
	beforeEach(() => {
		items.clear();
		applied.length = 0;
	});

	test("a pause that arrives after a newer resume is dropped", async () => {
		await timerPush("running", NOW - 1000);
		await timerPush("running", NOW);
		await timerPush("held", NOW - 500);
		expect(applied).toEqual(["running", "running"]);
	});

	test("the last sentAt is read from the store", async () => {
		await timerPush("running", NOW);
		// The app keeps no state in memory: only the store has the last sentAt.
		await timerPush("held", NOW - 1);
		expect(applied).toEqual(["running"]);
	});

	test("pushes with the same sentAt both apply", async () => {
		await timerPush("held", NOW);
		await timerPush("running", NOW);
		expect(applied).toEqual(["held", "running"]);
	});

	test("a newer push applies", async () => {
		await timerPush("running", NOW - 2000);
		await timerPush("held", NOW - 1000);
		expect(applied).toEqual(["running", "held"]);
	});
});
