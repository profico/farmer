/**
 * Does the custom palette hold its contrast all the way round the wheel?
 *
 *   bun run scripts/check-palette-contrast.ts
 *
 * Preferences → Display → Colors lets somebody generate a palette nobody has
 * ever looked at. The whole reason that is allowed near a timesheet is that
 * every role's LIGHTNESS is fixed and only hue and chroma move — OKLCH
 * lightness is perceptual, so contrast should barely notice the hue. "Barely"
 * is not "not at all": WCAG's own contrast formula is not perceptually
 * uniform, and a yellow at a given OKLCH lightness carries more relative
 * luminance than a blue at the same one. This walks the wheel and says whether
 * the drift ever grows into a real loss.
 *
 * THE THRESHOLD IS VANILLA, NOT WCAG. Measured against the hexes it ships,
 * vanilla is 4.20 for muted text on a band and 2.26 for `--faint` on one; a
 * check written to the round numbers those were meant to hit would fail the
 * palette this app has used all along, and a check the shipped design fails
 * teaches everyone to ignore it. So the promise made here is the one worth
 * keeping: a color somebody generated is never materially worse than the
 * color they would have had. `--fg` also carries an absolute floor, since
 * body text is the one pair no tolerance should be able to eat into.
 *
 * It also checks that every constant in that block was DERIVED from vanilla
 * rather than guessed. Seed (293, 0.168) — the logo's own #6f4ebe — has to
 * reproduce vanilla's accent and all six harmonised colors exactly. The
 * neutrals cannot be checked that way and must not be: vanilla pairs a WARM
 * ground with a COOL accent on purpose, and a one-seed scheme tints the greys
 * with the accent's own hue by definition, so Custom is a sibling of vanilla
 * and not a superset of it. What the neutrals owe vanilla is their LIGHTNESS
 * and their CHROMA, so each is checked at its own vanilla hue instead, which
 * is exactly the claim the ratios make.
 *
 * It is a script rather than a test because `apps/web` has no test suite, and
 * because its answer only changes when the numbers in `styles.css` do. Run it
 * after touching the custom palette block; a failure names the hue, the pair
 * and the ratio it got.
 *
 * The lightness and chroma constants below are copied from that block. They
 * are the one duplication here, and a mismatch shows up as a check that passes
 * against numbers the app does not use — so change them together.
 */

/** Every token this checks, and the only keys any table below may carry. A
 *  closed union rather than `string`, so a typo in one table is a type error
 *  and not a silently skipped pair. */
type Token =
	| "ground"
	| "bg"
	| "bg2"
	| "fg"
	| "mut"
	| "faint"
	| "acc"
	| Harmonised;
/** The tokens that keep their own lightness and chroma and rotate with the
 *  accent — see `--harmony` in the custom palette. */
type Harmonised = "warn" | "ok" | "bad" | "chart2" | "chart4" | "chart5";
type Neutral = Exclude<Token, "acc" | Harmonised>;
type Theme = "light" | "dark";

type Oklch = { l: number; c: number; h: number };

/** A neutral's fixed lightness, and its chroma as a fraction of the seed's. */
type Role = { l: number; ratio: number };

const LIGHT = {
	ground: { l: 0.9435, ratio: 0.059 },
	bg: { l: 0.982, ratio: 0.024 },
	bg2: { l: 0.9613, ratio: 0.042 },
	fg: { l: 0.2178, ratio: 0.035 },
	mut: { l: 0.5582, ratio: 0.092 },
	faint: { l: 0.7147, ratio: 0.113 },
} satisfies Record<Neutral, Role>;

const DARK = {
	ground: { l: 0.1591, ratio: 0.043 },
	bg: { l: 0.2127, ratio: 0.064 },
	bg2: { l: 0.25, ratio: 0.109 },
	fg: { l: 0.9322, ratio: 0.096 },
	mut: { l: 0.6293, ratio: 0.13 },
	faint: { l: 0.5064, ratio: 0.128 },
} satisfies Record<Neutral, Role>;

/** The accent, including the hue-dependent lightness ceiling the light half
 *  carries — see the comment beside `--acc` in the custom palette. `curve` is
 *  null where the lightness is flat. */
type Accent = {
	l: number;
	curve: { mid: number; amp: number; phase: number } | null;
	scale: number;
	min: number;
	max: number;
};

const ACCENT = {
	light: {
		l: 0.5174,
		curve: { mid: 0.536, amp: 0.045, phase: 4 },
		scale: 1,
		min: 0.06,
		max: 0.2,
	},
	dark: { l: 0.6407, curve: null, scale: 0.89, min: 0.05, max: 0.18 },
} satisfies Record<Theme, Accent>;

/** Each harmonised token's fixed lightness and chroma, and the hue it sits at
 *  in vanilla. The rotation itself is one number for all six. */
type Harmony = { l: number; c: number; h: number };

const HARMONISED = {
	light: {
		warn: { l: 0.5426, c: 0.0983, h: 84.4 },
		ok: { l: 0.5072, c: 0.0664, h: 148.6 },
		bad: { l: 0.5348, c: 0.1479, h: 25 },
		chart2: { l: 0.5741, c: 0.0394, h: 143.8 },
		chart4: { l: 0.5371, c: 0.0462, h: 39.2 },
		chart5: { l: 0.5288, c: 0.0376, h: 229 },
	},
	dark: {
		warn: { l: 0.7217, c: 0.0973, h: 86.3 },
		ok: { l: 0.6923, c: 0.0655, h: 150.3 },
		bad: { l: 0.7076, c: 0.1016, h: 23.7 },
		chart2: { l: 0.7045, c: 0.0488, h: 142.1 },
		chart4: { l: 0.6732, c: 0.0422, h: 39.8 },
		chart5: { l: 0.6683, c: 0.0394, h: 227.9 },
	},
} satisfies Record<Theme, Record<Harmonised, Harmony>>;

/** The rotation, straight out of `--harmony`: the shortest signed arc from
 *  vanilla's own hue to the seed's, clamped to 15 degrees. */
const harmony = (h: number) =>
	clamp(((((h - VANILLA_SEED.h + 180) % 360) + 360) % 360) - 180, -15, 15);

const SEED_MAX_CHROMA = 0.3;

/** `--tint`: how hard the seed is pushed into the greys. One at and under the
 *  default seed's own chroma, then linear — see the custom palette block. It
 *  is what fixes SEED_MAX_CHROMA above: raise either and the sweep below says
 *  which pair gives way first. */
const tint = (c: number) => Math.max(1, c / VANILLA_SEED.c);

/** Vanilla, straight out of `styles.css`, and the seed that should reproduce
 *  it. */
const VANILLA = {
	light: {
		ground: "#efece5",
		bg: "#faf9f6",
		bg2: "#f4f2ed",
		fg: "#1b1a17",
		mut: "#79736a",
		faint: "#a9a296",
		acc: "#6f4ebe",
		warn: "#8a6a1f",
		ok: "#4a7050",
		bad: "#b3423f",
		chart2: "#6b7f6a",
		chart4: "#86655a",
		chart5: "#55707d",
	},
	dark: {
		ground: "#0e0d0a",
		bg: "#1a1914",
		bg2: "#232219",
		fg: "#ede8de",
		mut: "#8f887c",
		faint: "#6b6459",
		acc: "#9178de",
		warn: "#c0a15a",
		ok: "#7fa887",
		bad: "#d98782",
		chart2: "#8fa88c",
		chart4: "#ae8e83",
		chart5: "#7c9aa8",
	},
} satisfies Record<Theme, Record<Token, string>>;
const VANILLA_SEED = { h: 293, c: 0.168 };

/** How much of vanilla's own contrast a generated palette may give up. Five
 *  per cent is under a tenth of a ratio point at the pairs that matter, which
 *  is below the point at which anybody could see a difference. */
const TOLERANCE = 0.95;

/** Two pairs answer to an absolute number instead of to vanilla. Body text,
 *  because no tolerance should be allowed to eat into it. And the accent,
 *  because holding every hue to VANILLA's ratio is the wrong promise: the
 *  violet is an unusually dark color for its lightness in WCAG's arithmetic,
 *  so matching it would force every cyan and teal accent to be muddy for no
 *  benefit anybody can see. What a button owes its label is 4.5. */
const FLOOR = { fg: 4.5, acc: 4.5, bg: 4.5 };

const floorFor = (token: Token) =>
	token === "fg" || token === "acc" || token === "bg" ? FLOOR[token] : 0;

const clamp = (value: number, min: number, max: number) =>
	Math.min(Math.max(value, min), max);

const accentLightness = (spec: Accent, h: number) =>
	spec.curve
		? Math.min(
				spec.l,
				spec.curve.mid +
					spec.curve.amp * Math.cos(((h - spec.curve.phase) * Math.PI) / 180),
			)
		: spec.l;

/** OKLCH → linear sRGB, then clipped into gamut the way a browser does before
 *  it paints. Clipping is what makes this honest: a vivid seed at a hue sRGB
 *  cannot reach is not the color the maths asked for, and the check has to
 *  measure what lands on the screen. */
const toLinearSrgb = ({ l, c, h }: Oklch) => {
	const radians = (h * Math.PI) / 180;
	const a = c * Math.cos(radians);
	const b = c * Math.sin(radians);

	const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;

	return [
		4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
		-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
		-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
	].map((channel) => clamp(channel, 0, 1));
};

const hexToLinearSrgb = (hex: string) => {
	const value = Number.parseInt(hex.slice(1), 16);
	return [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((c) => {
		const channel = c / 255;
		return channel <= 0.04045
			? channel / 12.92
			: ((channel + 0.055) / 1.055) ** 2.4;
	});
};

/** WCAG 2 relative luminance, from linear sRGB. */
const luminance = (rgb: number[]) =>
	0.2126 * (rgb[0] ?? 0) + 0.7152 * (rgb[1] ?? 0) + 0.0722 * (rgb[2] ?? 0);

const contrast = (a: number[], b: number[]) => {
	const la = luminance(a);
	const lb = luminance(b);
	return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

/** Every pair the design puts text on a surface in. The last is the accent as
 *  a button: `--primary-foreground` resolves to the island paper, so that pair
 *  is read back to front on purpose. */
const PAIRS: readonly { of: Token; on: Token; absolute?: true }[] = [
	{ of: "fg", on: "bg" },
	{ of: "fg", on: "bg2" },
	{ of: "fg", on: "ground" },
	{ of: "mut", on: "bg" },
	{ of: "mut", on: "bg2" },
	{ of: "mut", on: "ground" },
	{ of: "faint", on: "bg" },
	{ of: "faint", on: "bg2" },
	{ of: "faint", on: "ground" },
	{ of: "acc", on: "bg", absolute: true },
	{ of: "bg", on: "acc", absolute: true },
];

/** One whole palette, as the browser would paint it. */
const derive = (theme: Theme, h: number, c: number) => {
	const roles = theme === "light" ? LIGHT : DARK;
	const accent = ACCENT[theme];
	const neutral = (name: Neutral) =>
		toLinearSrgb({
			l: roles[name].l,
			c: c * roles[name].ratio * tint(c),
			h,
		});
	const rotated = (name: Harmonised) => {
		const spec = HARMONISED[theme][name];
		return toLinearSrgb({ l: spec.l, c: spec.c, h: spec.h + harmony(h) });
	};
	return {
		acc: toLinearSrgb({
			l: accentLightness(accent, h),
			c: clamp(c * accent.scale, accent.min, accent.max),
			h,
		}),
		ground: neutral("ground"),
		bg: neutral("bg"),
		bg2: neutral("bg2"),
		fg: neutral("fg"),
		mut: neutral("mut"),
		faint: neutral("faint"),
		warn: rotated("warn"),
		ok: rotated("ok"),
		bad: rotated("bad"),
		chart2: rotated("chart2"),
		chart4: rotated("chart4"),
		chart5: rotated("chart5"),
	} satisfies Record<Token, number[]>;
};

const THEMES: readonly Theme[] = ["light", "dark"];

const NEUTRALS: readonly Neutral[] = [
	"ground",
	"bg",
	"bg2",
	"fg",
	"mut",
	"faint",
];

/** Vanilla's own hue for each neutral. Not one value: the greys were drawn by
 *  hand and sit between 78 and 102 degrees. */
const NEUTRAL_HUE = {
	light: {
		ground: 87.5,
		bg: 91.4,
		bg2: 88.6,
		fg: 91.6,
		mut: 78.2,
		faint: 81.3,
	},
	dark: {
		ground: 91.7,
		bg: 97.8,
		bg2: 102.2,
		fg: 84.6,
		mut: 81.3,
		faint: 79.3,
	},
} satisfies Record<Theme, Record<Neutral, number>>;

/** Is every constant in the custom palette still vanilla's own? A drift here
 *  means a number in `styles.css` was edited away from the token it came from,
 *  and every check below would then be measuring a palette nobody designed.
 *
 *  Compared per channel, in 0-255 sRGB. An earlier version of this compared the
 *  two as a contrast ratio, which is a luminance measure and therefore blind to
 *  hue — it called a violet grey identical to a warm one. */
const drift = (a: number[], b: number[]) =>
	Math.max(
		...a.map((channel, i) =>
			Math.abs(Math.round(channel * 255) - Math.round((b[i] ?? 0) * 255)),
		),
	);

const reproduction: string[] = [];
for (const theme of THEMES) {
	const roles = theme === "light" ? LIGHT : DARK;
	const accent = ACCENT[theme];

	// Each neutral at ITS OWN vanilla hue: the seed's hue is the one thing here
	// that is meant to differ, so it is the one thing held equal.
	for (const name of NEUTRALS) {
		const off = drift(
			toLinearSrgb({
				l: roles[name].l,
				// tint() is 1 here by construction, and named rather than dropped so
				// that changing where it turns on cannot quietly skip this check.
				c: VANILLA_SEED.c * roles[name].ratio * tint(VANILLA_SEED.c),
				h: NEUTRAL_HUE[theme][name],
			}),
			hexToLinearSrgb(VANILLA[theme][name]),
		);
		if (off > 2) {
			reproduction.push(
				`  ${theme} --${name}: lightness or chroma is no longer vanilla's (off by ${off}/255)`,
			);
		}
	}

	const accOff = drift(
		toLinearSrgb({
			l: accentLightness(accent, VANILLA_SEED.h),
			c: clamp(VANILLA_SEED.c * accent.scale, accent.min, accent.max),
			h: VANILLA_SEED.h,
		}),
		hexToLinearSrgb(VANILLA[theme].acc),
	);
	if (accOff > 2) {
		reproduction.push(
			`  ${theme} --acc: seed 293 no longer reproduces the shipped accent (off by ${accOff}/255)`,
		);
	}

	// The harmonised six rotate by zero at vanilla's own hue, so these must land
	// on the shipped hex exactly.
	const derived = derive(theme, VANILLA_SEED.h, VANILLA_SEED.c);
	for (const name of [
		"warn",
		"ok",
		"bad",
		"chart2",
		"chart4",
		"chart5",
	] as const) {
		const off = drift(derived[name], hexToLinearSrgb(VANILLA[theme][name]));
		if (off > 2) {
			reproduction.push(
				`  ${theme} --${name}: seed 293 no longer reproduces the shipped color (off by ${off}/255)`,
			);
		}
	}
}

if (reproduction.length) {
	console.error("The custom palette has drifted from vanilla:\n");
	for (const line of reproduction) console.error(line);
	process.exit(1);
}

/** Vanilla's own ratio for a pair — the bar a generated palette has to clear. */
const baseline = (theme: Theme, of: Token, on: Token) =>
	contrast(
		hexToLinearSrgb(VANILLA[theme][of]),
		hexToLinearSrgb(VANILLA[theme][on]),
	);

type Failure = {
	theme: Theme;
	h: number;
	c: number;
	pair: string;
	got: number;
	want: number;
};

const failures: Failure[] = [];
let checked = 0;

for (const theme of THEMES) {
	// 5-degree steps, and chroma from grey to the ceiling the wheel allows.
	for (let h = 0; h < 360; h += 5) {
		// Twenty steps rather than a handful: `--tint` makes the neutrals grow
		// faster than the seed does, so the worst case is no longer guaranteed to
		// sit at the ceiling.
		for (let step = 0; step <= 20; step += 1) {
			const c = (SEED_MAX_CHROMA * step) / 20;
			const tokens = derive(theme, h, c);
			for (const pair of PAIRS) {
				checked += 1;
				const got = contrast(tokens[pair.of], tokens[pair.on]);
				const want = pair.absolute
					? floorFor(pair.of)
					: Math.max(
							baseline(theme, pair.of, pair.on) * TOLERANCE,
							floorFor(pair.of),
						);
				if (got + 0.005 < want) {
					failures.push({
						theme,
						h,
						c,
						pair: `${pair.of} on ${pair.on}`,
						got,
						want,
					});
				}
			}
		}
	}
}

if (failures.length === 0) {
	console.log(
		`Every constant still matches vanilla. ${checked} pairs checked across the wheel, none worse than vanilla by more than ${Math.round((1 - TOLERANCE) * 100)}%.`,
	);
	process.exit(0);
}

console.error(`${failures.length} of ${checked} pairs fall short:\n`);
// Worst first, so the fix is obvious: move that role's lightness in the custom
// palette block until the worst hue clears it.
for (const f of failures.sort((a, b) => a.got - b.got).slice(0, 40)) {
	console.error(
		`  ${f.theme}  hue ${String(f.h).padStart(3)}  chroma ${f.c
			.toFixed(2)
			.padStart(
				4,
			)}  ${f.pair.padEnd(16)} ${f.got.toFixed(2)} < ${f.want.toFixed(2)}`,
	);
}
process.exit(1);
