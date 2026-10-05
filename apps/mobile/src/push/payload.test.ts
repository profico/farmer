import { describe, expect, test } from "bun:test";

import { appTargetOf, timerPayload } from "./payload";

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
