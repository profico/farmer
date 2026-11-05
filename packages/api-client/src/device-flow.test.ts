import { describe, expect, test } from "bun:test";

import {
	CLI_CLIENT_ID,
	MOBILE_CLIENT_ID,
	pollForToken,
	requestDeviceCode,
} from "./device-flow";
import { jsonReply, ORIGIN, scriptedServer } from "./test-server";

const code = {
	device_code: "dev",
	user_code: "ABCDEFGH",
	verification_uri: "/device",
	expires_in: 600,
	interval: 5,
};

describe("requestDeviceCode", () => {
	test("asks with the app's client id", async () => {
		const { transport, requests } = scriptedServer([jsonReply(200, code)]);
		const result = await requestDeviceCode(transport);
		expect(result.clientId).toBe(MOBILE_CLIENT_ID);
		expect(requests[0]?.body).toContain(MOBILE_CLIENT_ID);
		expect(result.verificationUriComplete).toBe(
			`${ORIGIN}/device?user_code=ABCDEFGH`,
		);
	});

	test("falls back to the CLI's id on a server that does not know the app", async () => {
		const { transport, requests } = scriptedServer([
			jsonReply(400, {
				error: "invalid_client",
				error_description: "Invalid client ID",
			}),
			jsonReply(200, code),
		]);
		const result = await requestDeviceCode(transport);
		expect(result.clientId).toBe(CLI_CLIENT_ID);
		expect(requests[1]?.body).toContain(CLI_CLIENT_ID);
	});

	test("does not fall back on any other refusal", async () => {
		const { transport, requests } = scriptedServer([
			jsonReply(400, { error: "invalid_request" }),
		]);
		await expect(requestDeviceCode(transport)).rejects.toThrow(
			"did not start the sign-in",
		);
		expect(requests).toHaveLength(1);
	});
});

describe("pollForToken", () => {
	test("polls with the client id that got the code until approved", async () => {
		const { transport, requests } = scriptedServer([
			jsonReply(400, { error: "authorization_pending" }),
			jsonReply(400, { error: "slow_down" }),
			jsonReply(200, { access_token: "session-token" }),
		]);
		const token = await pollForToken(
			transport,
			{
				clientId: CLI_CLIENT_ID,
				deviceCode: "dev",
				userCode: "ABCDEFGH",
				verificationUri: `${ORIGIN}/device`,
				verificationUriComplete: `${ORIGIN}/device?user_code=ABCDEFGH`,
				expiresInSeconds: 600,
				intervalSeconds: 5,
			},
			{ now: () => 0, cancelled: () => false },
		);
		expect(token).toBe("session-token");
		expect(requests).toHaveLength(3);
		expect(requests[2]?.body).toContain(CLI_CLIENT_ID);
	});

	test("stops quietly once cancelled", async () => {
		const { transport, requests } = scriptedServer([]);
		const token = await pollForToken(
			transport,
			{
				clientId: MOBILE_CLIENT_ID,
				deviceCode: "dev",
				userCode: "ABCDEFGH",
				verificationUri: `${ORIGIN}/device`,
				verificationUriComplete: `${ORIGIN}/device?user_code=ABCDEFGH`,
				expiresInSeconds: 600,
				intervalSeconds: 5,
			},
			{ now: () => 0, cancelled: () => true },
		);
		expect(token).toBeNull();
		expect(requests).toHaveLength(0);
	});
});
