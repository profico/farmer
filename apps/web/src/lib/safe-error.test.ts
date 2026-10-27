import { describe, expect, test } from "bun:test";

import { DrizzleQueryError } from "drizzle-orm/errors";

import { safeError } from "./safe-error.ts";

describe("safeError", () => {
	test("keeps the bound parameters out of a database error", () => {
		const token = "raw-session-token-123";
		const cause = Object.assign(new Error("connection lost"), {
			code: "08006",
		});
		const error = new DrizzleQueryError(
			'update "session" set "updated_at" = $1 where "token" = $2',
			["2026-01-01", token],
			cause,
		);
		expect(error.message).toContain(token);
		const safe = safeError(error, "/api/v1/session");
		const text = `${safe.message}\n${safe.stack}`;
		expect(text).not.toContain(token);
		expect(text).toContain("08006");
		expect(text).toContain("/api/v1/session");
	});

	test("returns any other error unchanged", () => {
		const error = new TypeError("x is undefined");
		expect(safeError(error)).toBe(error);
	});
});
