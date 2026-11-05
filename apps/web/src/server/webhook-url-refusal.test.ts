import { describe, expect, test } from "bun:test";

import {
	classifyServiceError,
	WebhookUrlRefusedError,
} from "@farmer/core/services";

import { withUrlRefusalReason } from "./webhook-url-refusal.ts";

const reason = "localhost is not reachable from the public internet";

const failureOf = async (write: () => Promise<never>) => {
	try {
		await withUrlRefusalReason(write);
	} catch (error) {
		if (error instanceof Error) return error;
	}
	throw new Error("the write did not fail");
};

describe("withUrlRefusalReason", () => {
	test("a refused URL becomes a refusal with its reason", async () => {
		const error = await failureOf(() =>
			Promise.reject(new WebhookUrlRefusedError(reason)),
		);
		const verdict = classifyServiceError(error);
		expect(verdict.kind).toBe("refused");
		expect(error.message).toBe(reason);
	});

	test("any other error passes through as it is", async () => {
		const original = new TypeError("connect ECONNREFUSED 10.0.0.5:5432");
		const error = await failureOf(() => Promise.reject(original));
		expect(error).toBe(original);
		expect(classifyServiceError(error).kind).toBe("unsafe");
	});

	test("a write that succeeds returns its value", async () => {
		expect(await withUrlRefusalReason(() => Promise.resolve(42))).toBe(42);
	});
});
