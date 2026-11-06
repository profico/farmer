import { describe, expect, test } from "bun:test";

import { claimServerFnError, isServerFnFault } from "./posthog-api";

describe("claimServerFnError", () => {
	test("the same error object is claimed once", () => {
		const error = new Error("boom");
		expect(claimServerFnError(error)).toBe(true);
		expect(claimServerFnError(error)).toBe(false);
	});

	test("a different error object is claimed again", () => {
		expect(claimServerFnError(new Error("a"))).toBe(true);
		expect(claimServerFnError(new Error("a"))).toBe(true);
	});
});

describe("isServerFnFault and better-auth errors", () => {
	test("a 4xx APIError is not a fault", async () => {
		const { APIError } = await import("better-auth/api");
		expect(await isServerFnFault(APIError.fromStatus("FORBIDDEN"))).toBe(false);
	});

	test("a 5xx APIError is a fault", async () => {
		const { APIError } = await import("better-auth/api");
		expect(
			await isServerFnFault(APIError.fromStatus("INTERNAL_SERVER_ERROR")),
		).toBe(true);
	});
});

describe("isServerFnFault", () => {
	test("an unexpected error is a fault", async () => {
		expect(await isServerFnFault(new TypeError("x is undefined"))).toBe(true);
	});

	test("an access error is not", async () => {
		const { AccessError } = await import("@farmer/core/services");
		expect(await isServerFnFault(new AccessError("No."))).toBe(false);
	});
});
