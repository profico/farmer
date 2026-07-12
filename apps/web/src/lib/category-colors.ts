export type CategoryColor = {
	/** Solid dot/rail color. */
	dot: string;
	/** Soft tint used as a block/badge background. */
	tint: string;
	/** Darker on-tint text color for labels drawn on `tint`. */
	text: string;
};

// The 5 project/entry-type category colors from the design system, in
// picker order.
// Tint/text are only consumed by the calendar day/week blocks (CalendarBlock)
// — kept noticeably more saturated than a typical pastel badge tint so
// blocks stay easy to tell apart against the grid without a border rail.
export const CATEGORY_COLORS: CategoryColor[] = [
	{ dot: "#7b54d6", tint: "#e0d1f7", text: "#4a2f8f" }, // violet
	{ dot: "#2fa1a0", tint: "#bfe9e8", text: "#145251" }, // teal
	{ dot: "#d98a2b", tint: "#f5deac", text: "#7a5215" }, // amber
	{ dot: "#d2607a", tint: "#f5cad6", text: "#8a2e47" }, // rose
	{ dot: "#4fa36b", tint: "#c8e8d6", text: "#235736" }, // green
];

const FALLBACK_COLOR: CategoryColor = {
	dot: "#4a5568",
	tint: "#dadce2",
	text: "#252b38",
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

const WHITE: [number, number, number] = [255, 255, 255];
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
	tint: rgbToHex(...mix(rgb, WHITE, 0.8)),
	text: rgbToHex(...mix(rgb, BLACK, 0.45)),
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
