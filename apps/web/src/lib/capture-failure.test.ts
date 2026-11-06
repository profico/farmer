import { describe, expect, test } from "bun:test";

import { captureFailure } from "./capture-failure";

const run = (error: Error) =>
	captureFailure(
		{
			next: () => Promise.reject(error),
			serverFnMeta: { name: "fn", filename: "file.ts" },
		},
		// No request here: the capture fails, and the error must still come out.
		() => {
			throw new Error("no request");
		},
	);

describe("captureFailure", () => {
	test("rethrows the same fault object", async () => {
		const error = new TypeError("x is undefined");
		expect(await run(error).catch((e) => e)).toBe(error);
	});

	test("rethrows the same refusal object", async () => {
		const { AccessError } = await import("@farmer/core/services");
		const error = new AccessError("No.");
		expect(await run(error).catch((e) => e)).toBe(error);
	});
});
