/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";

import { ApiClientError, type ApiClientErrorKind } from "@farmer/api-client";

import { isTransient, shouldRetry } from "./retry";

const failure = (kind: ApiClientErrorKind, status?: number) =>
	new ApiClientError(kind, "failed", { status });

describe("shouldRetry", () => {
	test("retries a network fault and a server error, twice", () => {
		for (const error of [failure("unreachable"), failure("http", 503)]) {
			expect(shouldRetry(0, error)).toBe(true);
			expect(shouldRetry(1, error)).toBe(true);
			expect(shouldRetry(2, error)).toBe(false);
		}
	});

	test("does not retry a refusal", () => {
		for (const status of [400, 403, 404, 409, 422, 429]) {
			expect(shouldRetry(0, failure("http", status))).toBe(false);
		}
		expect(shouldRetry(0, failure("unauthorized", 401))).toBe(false);
		expect(shouldRetry(0, failure("no_access", 403))).toBe(false);
	});

	test("does not retry an answer the app cannot use, or a plain error", () => {
		expect(shouldRetry(0, failure("invalid_response", 200))).toBe(false);
		expect(shouldRetry(0, failure("update_required", 426))).toBe(false);
		expect(shouldRetry(0, new Error("bug"))).toBe(false);
	});

	test("does not retry a redirect, whatever its status", () => {
		// A retry would follow the same redirect, so the kind decides and the
		// status does not. A 5xx status must not make a redirect transient.
		for (const status of [undefined, 308, 502, 503]) {
			const error = failure("redirected", status);
			expect(isTransient(error)).toBe(false);
			expect(shouldRetry(0, error)).toBe(false);
		}
	});
});
