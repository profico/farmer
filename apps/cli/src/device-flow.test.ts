import { describe, expect, test } from "bun:test";

import {
	type DeviceCode,
	formatUserCode,
	pollForToken,
	requestDeviceCode,
} from "./device-flow";
import { jsonReply, scriptedServer } from "./test-server";

const CODE: DeviceCode = {
	deviceCode: "device-123",
	userCode: "ABCD-EFGH",
	verificationUri: "https://farmer.test/device",
	verificationUriComplete: "https://farmer.test/device?user_code=ABCD-EFGH",
	expiresInSeconds: 600,
	intervalSeconds: 5,
};

const pending = () =>
	jsonReply(400, {
		error: "authorization_pending",
		error_description: "Waiting",
	});

describe("pollForToken", () => {
	test("waits the interval, adds 5 seconds on slow_down, and returns the token", async () => {
		const { transport, sleeps, requests } = scriptedServer([
			pending(),
			jsonReply(400, { error: "slow_down" }),
			pending(),
			jsonReply(200, {
				access_token: "session-token",
				token_type: "Bearer",
				expires_in: 604800,
			}),
		]);
		const token = await pollForToken(transport, CODE, () => 0);

		expect(token).toBe("session-token");
		expect(sleeps).toEqual([5000, 5000, 10_000, 10_000]);
		const [first] = requests;
		expect(first?.url).toBe("https://farmer.test/api/auth/device/token");
		expect(JSON.parse(first?.body ?? "null")).toEqual({
			grant_type: "urn:ietf:params:oauth:grant-type:device_code",
			device_code: "device-123",
			client_id: "farmer-cli",
		});
		// The token request creates the session, and the session is named from
		// this header.
		expect(first?.headers.get("user-agent")).toBe(
			"farmer-cli/0.1.0 (linux; x64)",
		);
	});

	test("an expired code stops with a message", async () => {
		const { transport } = scriptedServer([
			jsonReply(400, { error: "expired_token" }),
		]);
		await expect(pollForToken(transport, CODE, () => 0)).rejects.toThrow(
			"The code expired",
		);
	});

	test("a denied code stops with a message", async () => {
		const { transport } = scriptedServer([
			jsonReply(400, { error: "access_denied" }),
		]);
		await expect(pollForToken(transport, CODE, () => 0)).rejects.toThrow(
			"denied in the browser",
		);
	});

	test("stops without a request once the code lifetime has passed", async () => {
		const { transport, requests } = scriptedServer([]);
		let now = 0;
		const clock = () => {
			const current = now;
			now += 601_000;
			return current;
		};
		await expect(pollForToken(transport, CODE, clock)).rejects.toThrow(
			"The code expired",
		);
		expect(requests).toHaveLength(0);
	});
});

describe("formatUserCode", () => {
	// better-auth answers the code with no dash, and `/device` shows it in groups
	// of four. The terminal must show the same thing the page does.
	test("groups the code in fours, as the approval page shows it", () => {
		expect(formatUserCode("7QC2LB78")).toBe("7QC2-LB78");
		expect(formatUserCode("ABCDEFGHIJ")).toBe("ABCD-EFGH-IJ");
		expect(formatUserCode("ABC")).toBe("ABC");
	});
});

describe("requestDeviceCode", () => {
	test("sends the CLI client id and resolves a relative verification URI", async () => {
		const { transport, requests } = scriptedServer([
			jsonReply(200, {
				device_code: "device-123",
				user_code: "ABCD-EFGH",
				verification_uri: "/device",
				expires_in: 600,
				interval: 5,
			}),
		]);
		const code = await requestDeviceCode(transport);

		expect(JSON.parse(requests[0]?.body ?? "null")).toEqual({
			client_id: "farmer-cli",
		});
		expect(code.verificationUri).toBe("https://farmer.test/device");
		expect(code.verificationUriComplete).toBe(
			"https://farmer.test/device?user_code=ABCD-EFGH",
		);
		expect(code.intervalSeconds).toBe(5);
	});
});
