import { describe, expect, test } from "bun:test";

import {
	notificationSettingsSchema,
	remindersChannelOf,
} from "./schemas-member";

describe("notification settings", () => {
	test("a channel of a newer server parses, and reads as unknown", () => {
		const parsed = notificationSettingsSchema.parse({
			logReminders: true,
			remindersChannel: "teams",
		});
		expect(parsed.remindersChannel).toBe("teams");
		expect(remindersChannelOf(parsed.remindersChannel)).toBeNull();
	});

	test("the known channels read as themselves", () => {
		expect(remindersChannelOf("app")).toBe("app");
		expect(remindersChannelOf("slack")).toBe("slack");
	});
});
