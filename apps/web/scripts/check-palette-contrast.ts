/**
 * Does the custom palette hold its contrast all the way round the wheel?
 *
 *   bun run scripts/check-palette-contrast.ts
 *
 * A custom palette (Preferences, Display, Colors) fixes the lightness of each
 * role and moves only hue and chroma. OKLCH lightness is perceptual, but the
 * WCAG contrast formula is not, so a yellow carries more luminance than a blue
 * at the same lightness. This script walks the hue wheel and reports where the
 * contrast drops too far.
 *
 * The threshold is the vanilla palette, not WCAG. Vanilla scores 4.20 for muted
 * text on a band and 2.26 for `--faint`, so a WCAG threshold would fail the
 * shipped design. A generated color must never be materially worse than the
 * vanilla color. `--fg` also has an absolute floor.
 *
 * It also checks that the constants were derived from vanilla. Seed (293,
 * 0.168) must reproduce the vanilla accent and the six harmonised colors. The
 * neutrals cannot match, because vanilla pairs a warm ground with a cool
 * accent. Each neutral is checked at its own vanilla hue, for lightness and
 * chroma.
 *
 * This is a script, not a test, because `apps/web` has no test suite. Run it
 * after you change the custom palette block in `styles.css`.
 *
 * The lightness and chroma constants below are copied from that block. Change
 * both together, or the check passes against numbers the app does not use.
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
/** Preferences → Display → High contrast. A second palette per theme, drawn on
 *  the same paper: the surfaces do not move and only the ink is pushed. Swept
 *  here as its own dimension, because a generated palette AND a contrast mode
 *  is a combination nobody has ever looked at. */
type Contrast = "normal" | "high";

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

/** High contrast, written as what it CHANGES rather than as a second table.
 *  The spread is the claim: three surfaces and `--fg` are byte-for-byte the
 *  normal ones, so a reader who turns the switch on gets the same paper and
 *  the same body text, and everything else drawn harder on it.
 *
 *  `--fg` is left alone deliberately. It already measures 14.75 against its
 *  worst surface; there is nothing to win by darkening it, and moving it would
 *  be a change to the design rather than to its legibility. */
const ROLES = {
	normal: { light: LIGHT, dark: DARK },
	high: {
		light: {
			...LIGHT,
			mut: { l: 0.4223, ratio: 0.092 },
			faint: { l: 0.5239, ratio: 0.113 },
		},
		dark: {
			...DARK,
			mut: { l: 0.7456, ratio: 0.13 },
			faint: { l: 0.6295, ratio: 0.128 },
		},
	},
} satisfies Record<Contrast, Record<Theme, Record<Neutral, Role>>>;

const CONTRASTS: readonly Contrast[] = ["normal", "high"];

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
	normal: {
		light: {
			l: 0.5174,
			curve: { mid: 0.536, amp: 0.045, phase: 4 },
			scale: 1,
			min: 0.06,
			max: 0.2,
		},
		dark: { l: 0.6407, curve: null, scale: 0.89, min: 0.05, max: 0.18 },
	},
	/** High contrast keeps the SHAPE of the light curve and lowers it whole.
	 *  The curve is the shape of WCAG's own luminance error across the wheel —
	 *  highest around red, lowest around hue 190 — and that shape does not
	 *  change when the bar it has to clear moves from 4.5 to 7. `mid` is the
	 *  one number fitted, by the sweep below. */
	high: {
		light: {
			l: 0.4292,
			curve: { mid: 0.4146, amp: 0.045, phase: 4 },
			scale: 1,
			min: 0.06,
			max: 0.2,
		},
		dark: { l: 0.7561, curve: null, scale: 0.89, min: 0.05, max: 0.18 },
	},
} satisfies Record<Contrast, Record<Theme, Accent>>;

/** Each harmonised token's fixed lightness and chroma, and the hue it sits at
 *  in vanilla. The rotation itself is one number for all six. */
type Harmony = { l: number; c: number; h: number };

const HARMONISED = {
	normal: {
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
	},
	/** The same six, at the lightness each needs to reach 7 against the worst
	 *  of the three surfaces. Chroma and hue are untouched, so the gaps that
	 *  tell one chart series from the next survive the switch exactly, and so
	 *  does the rotation. */
	high: {
		light: {
			warn: { l: 0.4202, c: 0.0983, h: 84.4 },
			ok: { l: 0.4138, c: 0.0664, h: 148.6 },
			bad: { l: 0.4374, c: 0.1479, h: 25 },
			chart2: { l: 0.4172, c: 0.0394, h: 143.8 },
			chart4: { l: 0.4253, c: 0.0462, h: 39.2 },
			chart5: { l: 0.4207, c: 0.0376, h: 229 },
		},
		dark: {
			warn: { l: 0.7567, c: 0.0973, h: 86.3 },
			ok: { l: 0.7465, c: 0.0655, h: 150.3 },
			bad: { l: 0.7654, c: 0.1016, h: 23.7 },
			chart2: { l: 0.7486, c: 0.0488, h: 142.1 },
			chart4: { l: 0.7574, c: 0.0422, h: 39.8 },
			chart5: { l: 0.7488, c: 0.0394, h: 227.9 },
		},
	},
} satisfies Record<Contrast, Record<Theme, Record<Harmonised, Harmony>>>;

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

/** Vanilla in high contrast, straight out of the `[data-contrast='high']`
 *  blocks in `styles.css`. The four surfaces are absent because they do not
 *  move — the entries below are spread over the normal table, which is the
 *  same claim `ROLES.high` makes and keeps the two from drifting apart. */
const VANILLA_HIGH = {
	light: {
		mut: "#524d44",
		faint: "#70695e",
		acc: "#5733a1",
		warn: "#664700",
		ok: "#305537",
		bad: "#922224",
		chart2: "#3f523f",
		chart4: "#65463c",
		chart5: "#37515e",
	},
	dark: {
		mut: "#b4ab9d",
		faint: "#90887b",
		acc: "#b49cff",
		warn: "#cbac65",
		ok: "#90b997",
		bad: "#ed9994",
		chart2: "#9db699",
		chart4: "#c9a89d",
		chart5: "#94b3c1",
	},
} satisfies Record<
	Theme,
	Record<Exclude<Token, "ground" | "bg" | "bg2" | "fg">, string>
>;

/** Vanilla, straight out of `styles.css`, and the seed that should reproduce
 *  it. */
const VANILLA_NORMAL = {
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

const VANILLA = {
	normal: VANILLA_NORMAL,
	high: {
		light: { ...VANILLA_NORMAL.light, ...VANILLA_HIGH.light },
		dark: { ...VANILLA_NORMAL.dark, ...VANILLA_HIGH.dark },
	},
} satisfies Record<Contrast, Record<Theme, Record<Token, string>>>;

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
/** Written out in full rather than as a partial record, so adding a token to
 *  `Token` is a type error here and not a pair that silently answers to
 *  nothing. */
const NO_FLOOR = {
	ground: 0,
	bg: 0,
	bg2: 0,
	fg: 0,
	mut: 0,
	faint: 0,
	acc: 0,
	warn: 0,
	ok: 0,
	bad: 0,
	chart2: 0,
	chart4: 0,
	chart5: 0,
} satisfies Record<Token, number>;

/** HIGH CONTRAST ANSWERS TO WCAG, NOT TO VANILLA. The tolerance above exists
 *  because the shipped design is the promise a generated palette has to keep;
 *  here the promise is the number somebody turned the switch on to get, so
 *  every role that carries text answers to 7 — AAA for body text, AA for the
 *  large type these also draw.
 *
 *  `faint` is the one exception and answers to 4.5. It has to stay a step
 *  quieter than `mut`, or the hierarchy the design is built on collapses into
 *  one weight. 4.5 is AA, where it draws at 2.26 today. */
const FLOOR = {
	normal: { ...NO_FLOOR, fg: 4.5, acc: 4.5, bg: 4.5 },
	high: {
		...NO_FLOOR,
		fg: 7,
		acc: 7,
		bg: 7,
		mut: 7,
		faint: 4.5,
		warn: 7,
		ok: 7,
		bad: 7,
		chart2: 7,
		chart4: 7,
		chart5: 7,
	},
} satisfies Record<Contrast, Record<Token, number>>;

const floorFor = (contrast: Contrast, token: Token) => FLOOR[contrast][token];

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
// NOT here: the accent on `--bg2` or on the ground. The accent is text as well
// as fill — every link in the app is `--acc` — so the pairs look like they
// belong. They do not: the lightness curve is fitted to hold the accent at 4.5
// against the ISLAND PAPER, and at the cyan end of the wheel a custom accent
// falls to 4.15 against the recessed ground. That is the shipped design, not a
// regression, and a check the shipped design fails is a check everyone learns
// to ignore. The high-contrast accent is chosen to clear 7 against the ground
// anyway, which is the stricter of the two directions.

/** One whole palette, as the browser would paint it. */
const derive = (contrast: Contrast, theme: Theme, h: number, c: number) => {
	const roles = ROLES[contrast][theme];
	const accent = ACCENT[contrast][theme];
	const neutral = (name: Neutral) =>
		toLinearSrgb({
			l: roles[name].l,
			c: c * roles[name].ratio * tint(c),
			h,
		});
	const rotated = (name: Harmonised) => {
		const spec = HARMONISED[contrast][theme][name];
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
for (const contrast of CONTRASTS) {
	for (const theme of THEMES) {
		const roles = ROLES[contrast][theme];
		const accent = ACCENT[contrast][theme];
		const where = contrast === "normal" ? theme : `${theme} high-contrast`;

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
				hexToLinearSrgb(VANILLA[contrast][theme][name]),
			);
			if (off > 2) {
				reproduction.push(
					`  ${where} --${name}: lightness or chroma is no longer vanilla's (off by ${off}/255)`,
				);
			}
		}

		const accOff = drift(
			toLinearSrgb({
				l: accentLightness(accent, VANILLA_SEED.h),
				c: clamp(VANILLA_SEED.c * accent.scale, accent.min, accent.max),
				h: VANILLA_SEED.h,
			}),
			hexToLinearSrgb(VANILLA[contrast][theme].acc),
		);
		if (accOff > 2) {
			reproduction.push(
				`  ${where} --acc: seed 293 no longer reproduces the shipped accent (off by ${accOff}/255)`,
			);
		}

		// The harmonised six rotate by zero at vanilla's own hue, so these must land
		// on the shipped hex exactly.
		const derived = derive(contrast, theme, VANILLA_SEED.h, VANILLA_SEED.c);
		for (const name of [
			"warn",
			"ok",
			"bad",
			"chart2",
			"chart4",
			"chart5",
		] as const) {
			const off = drift(
				derived[name],
				hexToLinearSrgb(VANILLA[contrast][theme][name]),
			);
			if (off > 2) {
				reproduction.push(
					`  ${where} --${name}: seed 293 no longer reproduces the shipped color (off by ${off}/255)`,
				);
			}
		}
	}
}

if (reproduction.length) {
	console.error("The custom palette has drifted from vanilla:\n");
	for (const line of reproduction) console.error(line);
	process.exit(1);
}

/** Vanilla's own ratio for a pair — the bar a generated palette has to clear.
 *  Read from the same contrast level, so a high-contrast custom palette is
 *  measured against high-contrast vanilla and not against the quieter one. */
const baseline = (level: Contrast, theme: Theme, of: Token, on: Token) =>
	contrast(
		hexToLinearSrgb(VANILLA[level][theme][of]),
		hexToLinearSrgb(VANILLA[level][theme][on]),
	);

type Failure = {
	level: Contrast;
	theme: Theme;
	h: number;
	c: number;
	pair: string;
	got: number;
	want: number;
};

const failures: Failure[] = [];
let checked = 0;

for (const level of CONTRASTS) {
	for (const theme of THEMES) {
		// 5-degree steps, and chroma from grey to the ceiling the wheel allows.
		for (let h = 0; h < 360; h += 5) {
			// Twenty steps rather than a handful: `--tint` makes the neutrals grow
			// faster than the seed does, so the worst case is no longer guaranteed to
			// sit at the ceiling.
			for (let step = 0; step <= 20; step += 1) {
				const c = (SEED_MAX_CHROMA * step) / 20;
				const tokens = derive(level, theme, h, c);
				for (const pair of PAIRS) {
					checked += 1;
					const got = contrast(tokens[pair.of], tokens[pair.on]);
					const want = pair.absolute
						? floorFor(level, pair.of)
						: Math.max(
								baseline(level, theme, pair.of, pair.on) * TOLERANCE,
								floorFor(level, pair.of),
							);
					if (got + 0.005 < want) {
						failures.push({
							level,
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
}

if (failures.length === 0) {
	console.log(
		`Every constant still matches vanilla. ${checked} pairs checked across the wheel, at both contrast levels, none worse than vanilla by more than ${Math.round((1 - TOLERANCE) * 100)}%.`,
	);
	process.exit(0);
}

console.error(`${failures.length} of ${checked} pairs fall short:\n`);
// Worst first, so the fix is obvious: move that role's lightness in the custom
// palette block until the worst hue clears it.
for (const f of failures.sort((a, b) => a.got - b.got).slice(0, 40)) {
	console.error(
		`  ${`${f.theme} ${f.level}`.padEnd(13)} hue ${String(f.h).padStart(
			3,
		)}  chroma ${f.c
			.toFixed(2)
			.padStart(
				4,
			)}  ${f.pair.padEnd(16)} ${f.got.toFixed(2)} < ${f.want.toFixed(2)}`,
	);
}
process.exit(1);
