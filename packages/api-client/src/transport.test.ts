// The transport's timeout and redirect rules. A fake fetch never answers
// until it is aborted, and fake timers move the clock.

import { afterEach, describe, expect, jest, test } from "bun:test";

import { FarmerClient } from "./client";
import { ApiClientError } from "./errors";
import { ORIGIN, scriptedServer } from "./test-server";
import {
	type FetchLike,
	openStream,
	send,
	SLOW_REQUEST_TIMEOUT_MS,
	type Transport,
} from "./transport";

const hangingFetch: FetchLike = (_url, init) =>
	new Promise((_resolve, reject) => {
		init.signal.addEventListener("abort", () =>
			reject(new Error("The operation was aborted.")),
		);
	});

const transportOf = (fetch: FetchLike): Transport => ({
	origin: ORIGIN,
	userAgent: "farmer-mobile/0.1.0 (test)",
	sleep: async () => undefined,
	fetch,
});

const failureOf = async (promise: Promise<unknown>) => {
	try {
		await promise;
	} catch (error) {
		if (error instanceof ApiClientError) return error;
		throw error;
	}
	throw new Error("The call did not fail.");
};

afterEach(() => {
	jest.useRealTimers();
});

describe("the timeout", () => {
	test("a call that times out says so, not that the server is unreachable", async () => {
		jest.useFakeTimers();
		const failure = failureOf(
			send(transportOf(hangingFetch), {
				method: "GET",
				path: "/api/v1/me",
				token: "tok",
			}),
		);
		jest.advanceTimersByTime(20_000);
		const error = await failure;
		expect(error.message).toContain("did not answer within 20 seconds");
		expect(error.message).not.toContain("Check the address");
	});

	test("a failed connection keeps the address message", async () => {
		const failing = transportOf(async () => {
			throw new Error("connect ECONNREFUSED");
		});
		const error = await failureOf(
			send(failing, { method: "GET", path: "/api/v1/me", token: "tok" }),
		);
		expect(error.message).toContain("Check the address");
	});

	test("a slow admin call waits longer than a plain one", async () => {
		jest.useFakeTimers();
		let settled = false;
		const failure = failureOf(
			new FarmerClient(transportOf(hangingFetch), "tok").matchSlackPeople(
				"acme",
			),
		).then((error) => {
			settled = true;
			return error;
		});
		jest.advanceTimersByTime(SLOW_REQUEST_TIMEOUT_MS - 1000);
		await Promise.resolve();
		expect(settled).toBe(false);
		jest.advanceTimersByTime(1000);
		const error = await failure;
		expect(error.message).toContain("did not answer within 60 seconds");
	});

	test("a stream that gets no headers in time reports the timeout", async () => {
		jest.useFakeTimers();
		const failure = failureOf(
			openStream(transportOf(hangingFetch), {
				method: "POST",
				path: "/api/v1/assistant",
				token: "tok",
			}),
		);
		jest.advanceTimersByTime(20_000);
		expect((await failure).message).toContain("did not answer within");
	});
});

describe("a redirect", () => {
	const redirect = () =>
		new Response(null, {
			status: 308,
			headers: { location: "https://other.test/api/v1/me" },
		});

	test("is not followed and is named", async () => {
		const { transport, requests } = scriptedServer([redirect()]);
		const error = await failureOf(new FarmerClient(transport, "tok").me());
		expect(error.kind).toBe("unreachable");
		expect(error.message).toContain("redirects to https://other.test");
		expect(error.message).not.toContain("signed");
		expect(requests).toHaveLength(1);
	});

	test("the request asks for manual redirect handling", async () => {
		let seen = "";
		const transport = transportOf(async (_url, init) => {
			seen = init.redirect;
			return redirect();
		});
		await failureOf(
			send(transport, { method: "GET", path: "/api/v1/me", token: null }),
		);
		expect(seen).toBe("manual");
	});

	test("a stream request names the redirect too", async () => {
		const { transport } = scriptedServer([redirect()]);
		const error = await failureOf(
			openStream(transport, {
				method: "POST",
				path: "/api/v1/assistant",
				token: "tok",
			}),
		);
		expect(error.message).toContain("redirects to");
	});
});
