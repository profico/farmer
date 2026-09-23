/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";

import { applySecurityHeaders } from "./security-headers.ts";

describe("applySecurityHeaders", () => {
	test("adds the baseline headers to a response without them", () => {
		const headers = applySecurityHeaders(
			new Headers({ "Content-Type": "text/html" }),
		);
		expect(headers.get("content-security-policy")).toBe(
			"frame-ancestors 'none'",
		);
		expect(headers.get("x-content-type-options")).toBe("nosniff");
		expect(headers.get("referrer-policy")).toBe(
			"strict-origin-when-cross-origin",
		);
	});

	test("keeps a policy the route set itself", () => {
		const own = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
		const headers = applySecurityHeaders(
			new Headers({ "content-security-policy": own }),
		);
		expect(headers.get("content-security-policy")).toBe(own);
		expect(headers.get("x-content-type-options")).toBe("nosniff");
	});
});
