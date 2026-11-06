import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	spyOn,
	test,
} from "bun:test";

import { startFakeRelay } from "../test/fake-relay";
import { setInstanceSettingsForTests } from "./instance-settings";
import { logKeyRefusal, resetKeyLogsForTests, sendToRelay } from "./push-relay";

const relay = startFakeRelay();
const push = {
	relayId: "relay-id-0123456789ab",
	kind: "alert",
	ciphertext: "c".repeat(100),
} as const;

beforeEach(() => {
	relay.reset();
	resetKeyLogsForTests();
});
afterEach(() => {
	relay.setEnabled(true);
});
afterAll(() => relay.stop());

const withKey = (key: string) =>
	setInstanceSettingsForTests({
		PUSH_RELAY_ENABLED: "true",
		PUSH_RELAY_URL: relay.url,
		PUSH_RELAY_KEY: key,
	});

describe("the server key", () => {
	test("is sent as a Bearer header", async () => {
		withKey("abc123.secret");
		const outcome = await sendToRelay(relay.url, push);
		expect(outcome).toEqual({ kind: "delivered" });
		expect(relay.authorizations).toEqual(["Bearer abc123.secret"]);
	});

	test("is not sent when none is set", async () => {
		await sendToRelay(relay.url, push);
		expect(relay.authorizations).toEqual([null]);
	});

	test("a key refusal is a failed outcome, one request, no retry", async () => {
		withKey("abc123.secret");
		relay.answer(push.relayId, {
			status: 429,
			error: "monthly_quota_exceeded",
		});
		const outcome = await sendToRelay(relay.url, push);
		expect(outcome).toEqual({
			kind: "failed",
			status: 429,
			code: "monthly_quota_exceeded",
		});
		expect(relay.authorizations).toHaveLength(1);
	});
});

describe("logKeyRefusal", () => {
	test("logs a key code once an hour and ignores other codes", () => {
		const error = spyOn(console, "error").mockImplementation(() => {});
		try {
			expect(logKeyRefusal("invalid_server_key")).toBe(true);
			expect(logKeyRefusal("invalid_server_key")).toBe(true);
			expect(logKeyRefusal("rate_limited")).toBe(false);
			expect(logKeyRefusal(null)).toBe(false);
			expect(error).toHaveBeenCalledTimes(1);
			expect(String(error.mock.calls[0]?.[0])).toContain("farmer@profi.co");
		} finally {
			error.mockRestore();
		}
	});
});
