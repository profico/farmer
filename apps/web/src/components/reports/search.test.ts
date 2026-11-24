/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";

import { searchSchema } from "./search.ts";

describe("searchSchema", () => {
	test("reads a bad value as absent and keeps the valid ones", () => {
		const parsed = searchSchema.parse({
			view: "breakdown",
			by: "person",
			preset: "decade",
		});
		expect(parsed.view).toBe("breakdown");
		expect(parsed.by).toBeUndefined();
		expect(parsed.preset).toBeUndefined();
	});

	test("passes valid values through", () => {
		const input = {
			tab: "absence",
			preset: "quarter",
			month: "2026-03",
			by: "teammate",
			type: "sick",
		} as const;
		expect(searchSchema.parse(input)).toEqual(input);
	});
});
