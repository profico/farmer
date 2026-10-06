// "Send reminders to" says where a reminder goes today. A person with no phone
// in the app must read that Slack is the fallback, not that "The app" works.

import { describe, expect, test } from "bun:test";

import { appChannelStatus } from "./reminders-channel.ts";

describe("the status under Send reminders to", () => {
	test("a phone that allows notifications needs no note", () => {
		expect(
			appChannelStatus({ relay: true, phones: 2, allowing: 1 }),
		).toBeNull();
	});

	test("a phone that blocks notifications says Slack is the fallback", () => {
		const status = appChannelStatus({ relay: true, phones: 1, allowing: 0 });
		expect(status).toContain("does not allow notifications");
		expect(status).toContain("Slack");
	});

	test("no phone says that the app is not signed in", () => {
		const status = appChannelStatus({ relay: true, phones: 0, allowing: 0 });
		expect(status).toContain("not signed in");
		expect(status).toContain("Slack");
	});
});
