import { describe, expect, test } from "bun:test";

import { contrastRatio, hexToOklch, oklchToHex } from "./color";
import { type SchemeColors, materialPalette } from "./material-palette";

// A scheme in the shape that `useMaterialColors` returns: `#RRGGBBAA`.
const SCHEME: SchemeColors = {
	background: "#FEF7FFFF",
	surface: "#FEF7FFFF",
	surfaceDim: "#DED8E1FF",
	surfaceBright: "#FEF7FFFF",
	surfaceContainerLowest: "#FFFFFFFF",
	surfaceContainerLow: "#F7F2FAFF",
	surfaceContainer: "#F3EDF7FF",
	surfaceContainerHigh: "#ECE6F0FF",
	surfaceContainerHighest: "#E6E0E9FF",
	onSurface: "#1D1B20FF",
	onSurfaceVariant: "#49454FFF",
	primary: "#6750A4FF",
	onPrimary: "#FFFFFFFF",
	primaryContainer: "#EADDFFFF",
	onPrimaryContainer: "#4F378BFF",
	inversePrimary: "#D0BCFFFF",
	secondary: "#625B71FF",
	onSecondary: "#FFFFFFFF",
	secondaryContainer: "#E8DEF8FF",
	onSecondaryContainer: "#4A4458FF",
	tertiary: "#7D5260FF",
	onTertiary: "#FFFFFFFF",
	tertiaryContainer: "#FFD8E4FF",
	onTertiaryContainer: "#633B48FF",
	inverseSurface: "#322F35FF",
	inverseOnSurface: "#F5EFF7FF",
	outline: "#79747EFF",
	outlineVariant: "#CAC4D0FF",
	error: "#B3261EFF",
	onError: "#FFFFFFFF",
	errorContainer: "#F9DEDCFF",
	onErrorContainer: "#8C1D18FF",
	scrim: "#000000FF",
};

describe("hexToOklch", () => {
	test("it inverts oklchToHex", () => {
		for (const hex of ["#6f4ebe", "#4a7050", "#8a6a1f", "#ede8de"]) {
			expect(oklchToHex(hexToOklch(hex))).toBe(hex);
		}
	});
});

describe("materialPalette", () => {
	test("it keeps the roles of the scheme", () => {
		const palette = materialPalette(SCHEME, "light", "normal");
		expect(palette.surfaceContainerHighest).toBe(
			SCHEME.surfaceContainerHighest,
		);
		expect(palette.onTertiary).toBe(SCHEME.onTertiary);
		expect(palette.inversePrimary).toBe(SCHEME.inversePrimary);
		expect(palette.scrim).toBe(SCHEME.scrim);
	});

	test("the ink on a status container reads at 4.5 or more", () => {
		for (const scheme of ["light", "dark"] as const) {
			for (const contrast of ["normal", "high"] as const) {
				const palette = materialPalette(SCHEME, scheme, contrast);
				for (const [container, ink] of [
					[palette.successContainer, palette.onSuccessContainer],
					[palette.warningContainer, palette.onWarningContainer],
				] as const) {
					expect(contrastRatio(String(container), String(ink))).toBeGreaterThan(
						4.5,
					);
				}
			}
		}
	});

	test("high contrast draws the quiet text harder", () => {
		const normal = materialPalette(SCHEME, "light", "normal");
		const high = materialPalette(SCHEME, "light", "high");
		const surface = "#FEF7FF";
		expect(
			contrastRatio(String(high.onSurfaceVariant), surface),
		).toBeGreaterThan(contrastRatio(String(normal.onSurfaceVariant), surface));
	});
});
