import { describe, expect, test } from "bun:test";

import { contrastRatio } from "./color";
import {
	type Contrast,
	farmerTokens,
	paletteOf,
	type Scheme,
	seedTokens,
	THEMES,
} from "./farmer-theme";

const SCHEMES: readonly Scheme[] = ["light", "dark"];
const CONTRASTS: readonly Contrast[] = ["normal", "high"];

describe("seedTokens", () => {
	// The web's own claim about its custom palette: at the logo's seed, the
	// accent and the status colours are exactly the vanilla ones. If the port
	// of the maths drifts, this is the first pair to move.
	test("the logo's seed gives the farmer accent and status colours", () => {
		for (const scheme of SCHEMES) {
			for (const contrast of CONTRASTS) {
				const seeded = seedTokens({ h: 293, c: 0.168 }, scheme, contrast);
				const farmer = farmerTokens(scheme, contrast);
				expect({
					acc: seeded.acc,
					warn: seeded.warn,
					ok: seeded.ok,
					bad: seeded.bad,
				}).toEqual({
					acc: farmer.acc,
					warn: farmer.warn,
					ok: farmer.ok,
					bad: farmer.bad,
				});
			}
		}
	});

	test("every theme keeps body text and a button label legible", () => {
		for (const theme of THEMES) {
			for (const scheme of SCHEMES) {
				for (const contrast of CONTRASTS) {
					const palette = paletteOf(
						theme.seed
							? seedTokens(theme.seed, scheme, contrast)
							: farmerTokens(scheme, contrast),
						scheme,
						contrast,
					);
					const floor = contrast === "high" ? 7 : 4.5;
					const pairs = [
						["onSurface", palette.onSurface, palette.background],
						["primary", palette.primary, palette.surface],
						["onPrimary", palette.onPrimary, palette.primary],
					] as const;
					for (const [role, ink, paper] of pairs) {
						expect({
							theme: theme.id,
							scheme,
							contrast,
							role,
							legible: contrastRatio(String(ink), String(paper)) >= floor,
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
