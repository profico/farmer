import { describe, expect, test } from "bun:test";

import { isBanned } from "./ban";

const NOW = new Date("2026-09-01T09:00:00Z");
const DAY = 86_400_000;

describe("isBanned", () => {
	test("a person who is not banned passes", () => {
		expect(isBanned({ banned: false, banExpires: null }, NOW)).toBe(false);
		expect(isBanned({ banned: null, banExpires: null }, NOW)).toBe(false);
	});

	test("a ban with no end holds", () => {
		expect(isBanned({ banned: true, banExpires: null }, NOW)).toBe(true);
	});

	test("a ban holds until its end date", () => {
		const future = new Date(NOW.getTime() + DAY);
		const past = new Date(NOW.getTime() - DAY);
		expect(isBanned({ banned: true, banExpires: future }, NOW)).toBe(true);
		expect(isBanned({ banned: true, banExpires: past }, NOW)).toBe(false);
	});
});
