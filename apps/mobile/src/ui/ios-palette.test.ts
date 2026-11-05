import { describe, expect, test } from "bun:test";

import { contrastRatio } from "./color";
import {
	type Contrast,
	farmerTokens,
	type Scheme,
	seedTokens,
	THEMES,
} from "./farmer-theme";
import { iosPaletteOf } from "./ios-palette";

const SCHEMES: readonly Scheme[] = ["light", "dark"];
const CONTRASTS: readonly Contrast[] = ["normal", "high"];

const paletteOfTheme = (
	theme: (typeof THEMES)[number],
	scheme: Scheme,
	contrast: Contrast,
) =>
	iosPaletteOf(
		theme.seed
			? seedTokens(theme.seed, scheme, contrast)
			: farmerTokens(scheme, contrast),
		scheme,
		contrast,
	);

describe("iosPaletteOf", () => {
	test("the screens use the system grouped colours", () => {
		const light = iosPaletteOf(
			farmerTokens("light", "normal"),
			"light",
			"normal",
		);
		const dark = iosPaletteOf(farmerTokens("dark", "normal"), "dark", "normal");
		expect([light.background, light.surface, light.onSurface]).toEqual([
			"#f2f2f7",
			"#ffffff",
			"#000000",
		]);
		expect([dark.background, dark.surface, dark.onSurface]).toEqual([
			"#000000",
			"#1c1c1e",
			"#ffffff",
		]);
	});

	test("the theme colour stays the tint of the app", () => {
		for (const theme of THEMES) {
			for (const scheme of SCHEMES) {
				const tokens = theme.seed
					? seedTokens(theme.seed, scheme, "normal")
					: farmerTokens(scheme, "normal");
				expect(paletteOfTheme(theme, scheme, "normal").primary).toBe(
					tokens.acc,
				);
			}
		}
	});

	test("text, tint and a prominent button stay legible", () => {
		for (const theme of THEMES) {
			for (const scheme of SCHEMES) {
				for (const contrast of CONTRASTS) {
					const palette = paletteOfTheme(theme, scheme, contrast);
					const high = contrast === "high";
					const pairs = [
						["label", palette.onSurface, palette.background, high ? 7 : 4.5],
						["label on a card", palette.onSurface, palette.surface, 4.5],
						[
							"secondary label",
							palette.onSurfaceVariant,
							palette.background,
							// The system's own secondary label is about 3:1 in
							// normal contrast.
							high ? 7 : 3,
						],
						[
							"tint on a card",
							palette.primary,
							palette.surface,
							high ? 4.5 : 3,
						],
						["label on the tint", palette.onPrimary, palette.primary, 4.5],
					] as const;
					for (const [role, ink, paper, floor] of pairs) {
						const ratio = contrastRatio(String(ink), String(paper));
						expect({
							theme: theme.id,
							scheme,
							contrast,
							role,
							legible: ratio >= floor,
						}).toEqual({
							theme: theme.id,
							scheme,
							contrast,
							role,
							legible: true,
						});
					}
				}
			}
		}
	});
});
