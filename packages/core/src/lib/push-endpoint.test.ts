// The push endpoint allowlist. `web-push` POSTs to whatever this lets through,
// so each refusal below is a request the server would otherwise have made on a
// stranger's behalf.

import { describe, expect, test } from "bun:test";

import { savePushSubscriptionInput } from "../schema/notifications";
import { isAllowedPushEndpoint } from "./push-endpoint";

describe("real browser push services", () => {
	test("are accepted", () => {
		for (const endpoint of [
			"https://fcm.googleapis.com/fcm/send/dXJsOnRva2Vu:APA91bH",
			"https://updates.push.services.mozilla.com/wpush/v2/gAAAAABk",
			"https://web.push.apple.com/QGk2ZS1hYmMxMjM",
			"https://wns2-par02p.notify.windows.com/w/?token=BQYAAAA",
			"https://db5p.notify.windows.com/w/?token=AwYAAAA",
		]) {
			expect(isAllowedPushEndpoint(endpoint)).toBe(true);
		}
	});
});

describe("anything else", () => {
	test("is refused", () => {
		for (const endpoint of [
			// Not a push service at all: the SSRF shapes.
			"https://169.254.169.254/latest/meta-data/",
			"https://127.0.0.1/",
			"https://localhost/",
			"https://example.com/push",
			// A push host, but not over HTTPS or on its own port.
			"http://fcm.googleapis.com/fcm/send/x",
			"https://fcm.googleapis.com:8443/fcm/send/x",
			// Credentials in the URL.
			"https://user:pass@fcm.googleapis.com/fcm/send/x",
			// Look-alikes: a suffix without its dot, a host under an attacker's
			// domain, a trailing dot.
			"https://evilpush.apple.com/x",
			"https://push.apple.com.attacker.example/x",
			"https://fcm.googleapis.com.attacker.example/x",
			"https://attacker-notify.windows.com/x",
			"https://fcm.googleapis.com./fcm/send/x",
			// Not a URL.
			"fcm.googleapis.com/fcm/send/x",
			"",
		]) {
			expect(isAllowedPushEndpoint(endpoint)).toBe(false);
		}
	});
});

describe("the subscription schema", () => {
	const keys = { p256dh: "p256dh", auth: "auth" };

	test("accepts a real subscription", () => {
		expect(
			savePushSubscriptionInput.safeParse({
				endpoint: "https://fcm.googleapis.com/fcm/send/abc",
				keys,
			}).success,
		).toBe(true);
	});

	test("refuses an endpoint that is not a push service", () => {
		expect(
			savePushSubscriptionInput.safeParse({
				endpoint: "https://10.0.0.1:6379/",
				keys,
			}).success,
		).toBe(false);
	});
});
