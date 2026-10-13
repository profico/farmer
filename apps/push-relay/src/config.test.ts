import { describe, expect, test } from "bun:test";

import { readConfig } from "./config";

describe("readConfig", () => {
	test("with no credentials both platforms are a dry run", () => {
		const config = readConfig({});
		expect(config.apns).toBeNull();
		expect(config.fcm).toBeNull();
		expect(config.port).toBe(3000);
		expect(config.dbPath).toBe("./data/relay.sqlite");
	});

	test("the device cap has a default, and an empty value keeps it", () => {
		expect(readConfig({}).maxDevices).toBe(100_000);
		expect(readConfig({ RELAY_MAX_DEVICES: "" }).maxDevices).toBe(100_000);
		expect(readConfig({ RELAY_MAX_DEVICES: "50" }).maxDevices).toBe(50);
		expect(() => readConfig({ RELAY_MAX_DEVICES: "0" })).toThrow(
			"RELAY_MAX_DEVICES",
		);
	});

	test("production refuses to start without TRUSTED_IP_HEADER", () => {
		const message = "Set TRUSTED_IP_HEADER in production";
		expect(() => readConfig({ NODE_ENV: "production" })).toThrow(message);
		expect(() =>
			readConfig({ NODE_ENV: "production", TRUSTED_IP_HEADER: "  " }),
		).toThrow(message);
	});

	test("production starts with a header name or an explicit none", () => {
		const header = readConfig({
			NODE_ENV: "production",
			TRUSTED_IP_HEADER: "cf-connecting-ip",
		});
		expect(header.trustedIpHeader).toBe("cf-connecting-ip");
		const none = readConfig({
			NODE_ENV: "production",
			TRUSTED_IP_HEADER: "none",
		});
		expect(none.trustedIpHeader).toBe("none");
	});

	test("outside production the header stays optional", () => {
		expect(readConfig({ NODE_ENV: "development" }).trustedIpHeader).toBe(
			undefined,
		);
	});

	test("a half-set APNs configuration stops the start", () => {
		expect(() => readConfig({ APNS_KEY_ID: "KEY123" })).toThrow(
			"Set all of APNS_KEY_P8, APNS_KEY_ID and APNS_TEAM_ID, or none of them.",
		);
	});

	test("the APNs topic defaults to the app's bundle id", () => {
		const config = readConfig({
			APNS_KEY_P8: "pem",
			APNS_KEY_ID: "KEY123",
			APNS_TEAM_ID: "TEAM123",
		});
		expect(config.apns?.topic).toBe("com.profico.farmer");
	});

	test("service-account JSON that does not parse stops the start without the key in the message", () => {
		expect(() =>
			readConfig({ FCM_SERVICE_ACCOUNT_JSON: '{"private_key":"SECRET"' }),
		).toThrow("FCM_SERVICE_ACCOUNT_JSON is not a service account key file.");
	});
});
