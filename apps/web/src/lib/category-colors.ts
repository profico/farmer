export type CategoryColor = {
	/** Solid dot/rail color. */
	dot: string;
	/** Soft tint used as a block/badge background. */
	tint: string;
	/** Darker on-tint text color for labels drawn on `tint`. */
	text: string;
};

// The 5 project/task category colors, in picker order.
//
// All five sit in the same muted, earthy register as the rest of the palette
// and are deliberately kept a step *below* the ember accent in chroma. A dot
// beside a task name is a label, not a signal: if a category read louder than
// the one accent colour the app uses for "act on this", the eye would start
// following project colours around the page instead of following actions. They
// still separate cleanly from each other by hue, which is all a category has to
// do.
export const CATEGORY_COLORS: CategoryColor[] = [
	{ dot: "#6b7f6a", tint: "#e0e3dd", text: "#455345" }, // sage
	{ dot: "#55707d", tint: "#dce0e0", text: "#374951" }, // slate
	{ dot: "#8a6a1f", tint: "#e6dfcf", text: "#5a4514" }, // ochre
	{ dot: "#9c5a44", tint: "#e9dcd6", text: "#653a2c" }, // rust
	{ dot: "#7a6a86", tint: "#e3dfe2", text: "#4f4557" }, // mauve
];

const FALLBACK_COLOR: CategoryColor = {
	dot: "#79736a",
	tint: "#e3e1dd",
	text: "#4f4b45",
};

const hexToRgb = (hex: string): [number, number, number] | null => {
	const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
	if (!match?.[1]) return null;
	const value = Number.parseInt(match[1], 16);
	return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
};

const rgbToHex = (r: number, g: number, b: number): string =>
	`#${[r, g, b]
		.map((c) =>
			Math.max(0, Math.min(255, Math.round(c)))
				.toString(16)
				.padStart(2, "0"),
		)
		.join("")}`;

// Linear blend of `rgb` toward `target` by `amount` (0 = rgb, 1 = target).
const mix = (
	rgb: [number, number, number],
	target: [number, number, number],
	amount: number,
): [number, number, number] => [
	rgb[0] + (target[0] - rgb[0]) * amount,
	rgb[1] + (target[1] - rgb[1]) * amount,
	rgb[2] + (target[2] - rgb[2]) * amount,
];

// Tints wash toward the page, not toward white: on warm paper a white-based
// tint reads as a lighter patch of some other material laid on top of the
// sheet, which is exactly the cut-out-card look this design avoids.
const PAPER: [number, number, number] = [250, 249, 246];
const BLACK: [number, number, number] = [0, 0, 0];

// The palette (+ neutral fallback) colors have hand-tuned tint/text pairs;
// look them up by their canonical dot hex so exact picks render those exactly.
const KNOWN_BY_DOT = new Map(
	[...CATEGORY_COLORS, FALLBACK_COLOR].map((c) => [c.dot.toLowerCase(), c]),
);

// Derives a full CategoryColor from any hex: the dot is the color itself, the
// tint is a near-white wash of it (calendar-block background), and the text is
// a darkened version that stays legible on that tint. Mirrors how the palette's
// hand-tuned pairs relate to their dots, so custom colors sit alongside them.
const deriveCategoryColor = (
	hex: string,
	rgb: [number, number, number],
): CategoryColor => ({
	dot: hex,
	tint: rgbToHex(...mix(rgb, PAPER, 0.82)),
	text: rgbToHex(...mix(rgb, BLACK, 0.35)),
});

// Resolves a stored hex to its display color set. Exact palette/neutral picks
// return their hand-tuned pair; any other valid hex (a custom color) is honored
// directly with a derived tint/text; anything unparseable falls back to neutral.
export const resolveCategoryColor = (
	hex: string | null | undefined,
): CategoryColor => {
	if (!hex) return FALLBACK_COLOR;
	const rgb = hexToRgb(hex);
	if (!rgb) return FALLBACK_COLOR;
	return (
		KNOWN_BY_DOT.get(hex.trim().toLowerCase()) ??
		deriveCategoryColor(hex.trim(), rgb)
	);
};
