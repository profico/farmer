/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";

import { safeRedirectPath, withOrgSlug } from "./org-redirect.ts";

describe("safeRedirectPath", () => {
	// Web code falls back to `/_`, because `/` is the public site.
	test("accepts the workspace placeholder", () => {
		expect(safeRedirectPath("/_")).toBe("/_");
		expect(safeRedirectPath("/_?email=person%40example.com")).toBe(
			"/_?email=person%40example.com",
		);
	});
});

describe("withOrgSlug", () => {
	test("leaves a slugified slug as it is", () => {
		expect(withOrgSlug("/", "acme-co")).toBe("/acme-co");
		expect(withOrgSlug("/old/settings?tab=1", "acme-co")).toBe(
			"/acme-co/settings?tab=1",
		);
	});

	// The slug is owner-controlled on the server, and impersonation navigates
	// to `withOrgSlug("/", slug)`. Each of these, spliced in raw, is a
	// protocol-relative URL to another origin.
	test.each(["/evil.example", "\\evil.example", "\t/evil.example"])(
		"keeps %j on this origin, in one path segment",
		(slug) => {
			const href = withOrgSlug("/", slug);
			expect(safeRedirectPath(href)).toBe(href);
			expect(href.indexOf("/", 1)).toBe(-1);
		},
	);
});
