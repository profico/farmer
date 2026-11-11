import { describe, expect, test } from "bun:test";

import { otherWorkspace } from "./shared-target";

const current = { origin: "https://farmer.example.com", slug: "acme" };

describe("otherWorkspace", () => {
	test("matches when both params are absent or equal", () => {
		expect(otherWorkspace({}, current)).toBeNull();
		expect(
			otherWorkspace(
				{ org: "acme", server: "https://farmer.example.com/" },
				current,
			),
		).toBeNull();
	});

	test("names the server host and the org on a mismatch", () => {
		expect(otherWorkspace({ org: "beta" }, current)).toEqual({
			server: "farmer.example.com",
			org: "beta",
		});
		expect(
			otherWorkspace({ server: "https://other.example.org:8080" }, current),
		).toEqual({ server: "other.example.org:8080", org: "acme" });
	});
});
