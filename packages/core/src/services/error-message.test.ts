import { describe, expect, test } from "bun:test";

import { DrizzleQueryError } from "drizzle-orm/errors";
import { z } from "zod";

import { AccessError } from "./access.service";
import { classifyServiceError, safeErrorMessage } from "./error-message";
import { DayCapacityError } from "./time-entries.service";

describe("what a client may be told about a service error", () => {
	test("a sentence a service threw on purpose passes", () => {
		expect(safeErrorMessage(new Error("Time entry not found"))).toBe(
			"Time entry not found",
		);
		expect(classifyServiceError(new Error("Time entry not found")).kind).toBe(
			"not_found",
		);
		expect(
			classifyServiceError(new Error("Only absence tasks can be logged")).kind,
		).toBe("refused");
		expect(safeErrorMessage(new AccessError("Admin access required"))).toBe(
			"Admin access required",
		);
	});

	test("a validation failure passes with its issues", () => {
		const parsed = z.object({ hours: z.number() }).safeParse({ hours: "x" });
		expect(parsed.success).toBe(false);
		if (parsed.success) return;
		const verdict = classifyServiceError(parsed.error);
		expect(verdict.kind).toBe("validation");
		expect(safeErrorMessage(parsed.error)).toContain("hours");
	});

	test("a full day passes", () => {
		const verdict = classifyServiceError(new DayCapacityError("2026-09-22"));
		expect(verdict.kind).toBe("capacity");
	});

	test("a database error is withheld, SQL and parameters included", () => {
		const error = new DrizzleQueryError(
			'select * from "user" where "email" = $1',
			["someone@example.com"],
			new Error('relation "user" does not exist'),
		);
		expect(classifyServiceError(error).kind).toBe("unsafe");
		expect(safeErrorMessage(error)).toBeNull();
	});

	test("a runtime error or a system error is withheld", () => {
		expect(safeErrorMessage(new TypeError("x is undefined"))).toBeNull();
		const system = Object.assign(new Error("connect ECONNREFUSED 10.0.0.5"), {
			code: "ECONNREFUSED",
		});
		expect(safeErrorMessage(system)).toBeNull();
	});
});
