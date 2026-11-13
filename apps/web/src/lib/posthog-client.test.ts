import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import posthog from "posthog-js";

import { fetchReportingNetworkErrors } from "./posthog-client";

describe("fetchReportingNetworkErrors", () => {
	const capture = spyOn(posthog, "capture").mockImplementation(() => undefined);

	beforeEach(() => {
		capture.mockClear();
		posthog.__loaded = true;
	});
	afterEach(() => {
		posthog.__loaded = false;
	});

	const callWith = (base: () => Promise<Response>) =>
		fetchReportingNetworkErrors(
			"abc",
			base,
		)("/_serverFn/abc").then(
			(response) => response,
			(error: Error) => error,
		);

	test("a fetch that rejects sends one event and rethrows the same error", async () => {
		const error = new TypeError("NetworkError when attempting to fetch");

		expect(await callWith(() => Promise.reject(error))).toBe(error);
		expect(capture).toHaveBeenCalledTimes(1);
		expect(capture.mock.calls[0]?.[0]).toBe("server_fn_network_error");
		expect(capture.mock.calls[0]?.[1]).toMatchObject({ server_fn_id: "abc" });
	});

	// A TypeError that a handler threw on the server comes back the same way:
	// as an answer that TanStack turns into an error after the fetch resolved.
	test("an error answer is returned and sends nothing", async () => {
		const answer = new Response("<html>Bad gateway</html>", { status: 502 });

		expect(await callWith(() => Promise.resolve(answer))).toBe(answer);
		expect(capture).not.toHaveBeenCalled();
	});

	test("an aborted fetch sends nothing", async () => {
		const abort = new DOMException("aborted", "AbortError");

		expect(await callWith(() => Promise.reject(abort))).toBe(abort);
		expect(capture).not.toHaveBeenCalled();
	});
});
