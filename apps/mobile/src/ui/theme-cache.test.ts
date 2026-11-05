/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";

import { paletteOf, themeTokens } from "./farmer-theme";
import { iosPaletteOf } from "./ios-palette";
import { themeCache } from "./theme-cache";

describe("themeCache", () => {
	const ios = themeCache(iosPaletteOf);
	const farmer = themeCache(paletteOf);

	test("the iOS palette is the one that iosPaletteOf builds", () => {
		for (const scheme of ["light", "dark"] as const) {
			for (const contrast of ["normal", "high"] as const) {
				const tokens = themeTokens("farmer", scheme, contrast);
				expect(ios("farmer", scheme, contrast).palette).toEqual(
					iosPaletteOf(tokens, scheme, contrast),
				);
			}
		}
	});

	test("the farmer palette is the one that paletteOf builds", () => {
		const tokens = themeTokens("farmer", "dark", "normal");
		expect(farmer("farmer", "dark", "normal").palette).toEqual(
			paletteOf(tokens, "dark", "normal"),
		);
	});

	test("a combination gives the same object each time", () => {
		expect(ios("farmer", "light", "normal")).toBe(
			ios("farmer", "light", "normal"),
		);
	});

	test("two palettes do not share an object", () => {
		expect(ios("farmer", "light", "normal")).not.toBe(
			farmer("farmer", "light", "normal"),
		);
	});
});
