import { describe, expect, test } from "bun:test";

import { appTargetOf, isSurfaceStop, timerPayload } from "./payload";

describe("appTargetOf", () => {
	test("maps the Server's web paths to app routes", () => {
		expect(appTargetOf("/acme/time")).toEqual({ path: "/", workspace: "acme" });
		expect(appTargetOf("/acme/time/month")).toEqual({
			path: "/",
			workspace: "acme",
		});
		expect(appTargetOf("/acme/reports?tab=compliance")).toEqual({
			path: "/reports",
			workspace: "acme",
		});
		expect(appTargetOf("/acme/settings/webhooks")).toEqual({
			path: "/workspace/webhooks",
			workspace: "acme",
		});
	});

	test("an unknown or missing path opens the Time tab", () => {
		expect(appTargetOf(undefined)).toEqual({ path: "/", workspace: null });
		expect(appTargetOf("https://evil.example/x")).toEqual({
			path: "/",
			workspace: null,
		});
		expect(appTargetOf("/acme/somewhere-new")).toEqual({
			path: "/",
			workspace: "acme",
		});
	});
});

describe("timerPayload", () => {
	test("reads what the Server seals for Android", () => {
		const parsed = timerPayload.parse({
			kind: "timer",
			event: "update",
			workspace: "Acme",
			project: null,
			task: "Design",
			state: {
				state: "held",
				runningSinceMs: null,
				accumulatedSeconds: 1200,
				workspace: "acme",
			},
		});
		expect(parsed.event).toBe("update");
		expect(timerPayload.parse({ kind: "timer", event: "end" }).event).toBe(
			"end",
		);
	});
});

describe("isSurfaceStop", () => {
	test("matches Stop from a timer surface in every URL form", () => {
		for (const url of [
			"farmer://stop-timer?source=timer-surface",
			"farmer:///stop-timer?source=timer-surface",
			"farmer://stop-timer/?source=timer-surface&x=1",
			"exp://192.168.1.2:8081/--/stop-timer?source=timer-surface",
		]) {
			expect(isSurfaceStop(url)).toBe(true);
		}
	});

	test("does not match another link", () => {
		for (const url of [
			"farmer://stop-timer",
			"farmer://stop-timer?source=other",
			"farmer://start-timer?source=timer-surface",
			"farmer://",
			"exp://192.168.1.2:8081/--/?source=timer-surface",
		]) {
			expect(isSurfaceStop(url)).toBe(false);
		}
	});
});
