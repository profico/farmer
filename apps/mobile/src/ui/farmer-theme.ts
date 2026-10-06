import { mixHex, oklchToHex } from "./color";
import type { Palette } from "./palette";

// The farmer palette and the seed themes of the web app, for the phone.
//
// The web draws its colours in `apps/web/src/styles.css`. "Farmer" is the
// web's vanilla palette (the hex tokens of `:root` and
// `:root[data-theme='dark']`). Each seed is the web's custom palette
// (`:root[data-palette='custom']`), computed from the same lightness and
// chroma constants, so a seed has the same colours here as on the web. The
// web's `scripts/check-palette-contrast.ts` checks those constants; keep
// these in step with that file.
//
// The tokens are the web's names. `paletteOf` maps them to the colour roles
// of the app (`Palette`), which use the Material 3 names.

export type Scheme = "light" | "dark";
export type Contrast = "normal" | "high";

/** The web's tokens that the app uses. */
export type Tokens = {
	/** The ground under the islands: the background of a screen. */
	ground: string;
	/** The island paper: a card, a list section, a sheet. */
	bg: string;
	/** A band inside an island. */
	bg2: string;
	fg: string;
	mut: string;
	faint: string;
	acc: string;
	warn: string;
	ok: string;
	bad: string;
};

/** A hue in degrees and a chroma, as the web's `--seed-h` and `--seed-c`. */
export type Seed = { h: number; c: number };

const VANILLA_SEED: Seed = { h: 293, c: 0.168 };

/** The web's vanilla palette, from `styles.css`. High contrast changes only
 *  the ink; the surfaces and `fg` do not move. */
const VANILLA = {
	normal: {
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
		},
	},
	high: {
		light: {
			mut: "#524d44",
			faint: "#70695e",
			acc: "#5733a1",
			warn: "#664700",
			ok: "#305537",
			bad: "#922224",
		},
		dark: {
			mut: "#b4ab9d",
			faint: "#90887b",
			acc: "#b49cff",
			warn: "#cbac65",
			ok: "#90b997",
			bad: "#ed9994",
		},
	},
} as const satisfies {
	normal: { [scheme in Scheme]: Tokens };
	high: {
		[scheme in Scheme]: Omit<Tokens, "ground" | "bg" | "bg2" | "fg">;
	};
};

/** The farmer palette: the web's vanilla tokens. */
export const farmerTokens = (scheme: Scheme, contrast: Contrast): Tokens =>
	contrast === "high"
		? { ...VANILLA.normal[scheme], ...VANILLA.high[scheme] }
		: VANILLA.normal[scheme];

type Neutral = "ground" | "bg" | "bg2" | "fg" | "mut" | "faint";

/** A neutral's fixed OKLCH lightness, and its chroma as a fraction of the
 *  seed's chroma. */
type Role = { l: number; ratio: number };

const NEUTRALS = {
	normal: {
		light: {
			ground: { l: 0.9435, ratio: 0.059 },
			bg: { l: 0.982, ratio: 0.024 },
			bg2: { l: 0.9613, ratio: 0.042 },
			fg: { l: 0.2178, ratio: 0.035 },
			mut: { l: 0.5582, ratio: 0.092 },
			faint: { l: 0.7147, ratio: 0.113 },
		},
		dark: {
			ground: { l: 0.1591, ratio: 0.043 },
			bg: { l: 0.2127, ratio: 0.064 },
			bg2: { l: 0.25, ratio: 0.109 },
			fg: { l: 0.9322, ratio: 0.096 },
			mut: { l: 0.6293, ratio: 0.13 },
			faint: { l: 0.5064, ratio: 0.128 },
		},
	},
	high: {
		light: {
			ground: { l: 0.9435, ratio: 0.059 },
			bg: { l: 0.982, ratio: 0.024 },
			bg2: { l: 0.9613, ratio: 0.042 },
			fg: { l: 0.2178, ratio: 0.035 },
			mut: { l: 0.4223, ratio: 0.092 },
			faint: { l: 0.5239, ratio: 0.113 },
		},
		dark: {
			ground: { l: 0.1591, ratio: 0.043 },
			bg: { l: 0.2127, ratio: 0.064 },
			bg2: { l: 0.25, ratio: 0.109 },
			fg: { l: 0.9322, ratio: 0.096 },
			mut: { l: 0.7456, ratio: 0.13 },
			faint: { l: 0.6295, ratio: 0.128 },
		},
	},
} as const satisfies {
	[contrast in Contrast]: { [scheme in Scheme]: { [n in Neutral]: Role } };
};

/** The accent. The light accent has a lightness ceiling that changes with
 *  the hue, so that white on a button stays at 4.5 or more for each hue. */
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
} as const satisfies {
	[contrast in Contrast]: { [scheme in Scheme]: Accent };
};

type Harmonised = "warn" | "ok" | "bad";

/** Each status colour's own lightness, chroma and vanilla hue. All three
 *  turn with the seed by one shared angle (`harmony`). */
const HARMONISED = {
	normal: {
		light: {
			warn: { l: 0.5426, c: 0.0983, h: 84.4 },
			ok: { l: 0.5072, c: 0.0664, h: 148.6 },
			bad: { l: 0.5348, c: 0.1479, h: 25 },
		},
		dark: {
			warn: { l: 0.7217, c: 0.0973, h: 86.3 },
			ok: { l: 0.6923, c: 0.0655, h: 150.3 },
			bad: { l: 0.7076, c: 0.1016, h: 23.7 },
		},
	},
	high: {
		light: {
			warn: { l: 0.4202, c: 0.0983, h: 84.4 },
			ok: { l: 0.4138, c: 0.0664, h: 148.6 },
			bad: { l: 0.4374, c: 0.1479, h: 25 },
		},
		dark: {
			warn: { l: 0.7567, c: 0.0973, h: 86.3 },
			ok: { l: 0.7465, c: 0.0655, h: 150.3 },
			bad: { l: 0.7654, c: 0.1016, h: 23.7 },
		},
	},
} as const satisfies {
	[contrast in Contrast]: {
		[scheme in Scheme]: {
			[t in Harmonised]: { l: number; c: number; h: number };
		};
	};
};

const clamp = (value: number, min: number, max: number) =>
	Math.min(Math.max(value, min), max);

/** `--harmony`: the shortest signed arc from the vanilla hue to the seed's
 *  hue, clamped to 15 degrees. */
const harmony = (h: number) =>
	clamp(((((h - VANILLA_SEED.h + 180) % 360) + 360) % 360) - 180, -15, 15);

/** `--tint`: 1 up to the vanilla chroma, then linear. */
const tint = (c: number) => Math.max(1, c / VANILLA_SEED.c);

const accentLightness = (spec: Accent, h: number) =>
	spec.curve
		? Math.min(
				spec.l,
				spec.curve.mid +
					spec.curve.amp * Math.cos(((h - spec.curve.phase) * Math.PI) / 180),
			)
		: spec.l;

/** The web's custom palette for one seed. */
export const seedTokens = (
	seed: Seed,
	scheme: Scheme,
	contrast: Contrast,
): Tokens => {
	const neutrals = NEUTRALS[contrast][scheme];
	const neutral = (role: Role) =>
		oklchToHex({ l: role.l, c: seed.c * role.ratio * tint(seed.c), h: seed.h });
	const accent = ACCENT[contrast][scheme];
	const turn = harmony(seed.h);
	const status = HARMONISED[contrast][scheme];
	const harmonised = (spec: { l: number; c: number; h: number }) =>
		oklchToHex({ l: spec.l, c: spec.c, h: spec.h + turn });
	return {
		ground: neutral(neutrals.ground),
		bg: neutral(neutrals.bg),
		bg2: neutral(neutrals.bg2),
		fg: neutral(neutrals.fg),
		mut: neutral(neutrals.mut),
		faint: neutral(neutrals.faint),
		acc: oklchToHex({
			l: accentLightness(accent, seed.h),
			c: clamp(seed.c * accent.scale, accent.min, accent.max),
			h: seed.h,
		}),
		warn: harmonised(status.warn),
		ok: harmonised(status.ok),
		bad: harmonised(status.bad),
	};
};

/** The theme colours, in the order of the picker. */
export const THEME_IDS = [
	"farmer",
	"violet",
	"indigo",
	"blue",
	"teal",
	"green",
	"amber",
	"rust",
	"crimson",
	"magenta",
	"slate",
] as const;

export type ThemeId = (typeof THEME_IDS)[number];

/** The theme colours a person can choose: the farmer palette, then the web's
 *  quick seeds (`QUICK_SEEDS` in `apps/web/src/lib/palette.ts`). */
export const THEMES = [
	{ id: "farmer", label: "Farmer", seed: null },
	{ id: "violet", label: "Violet", seed: VANILLA_SEED },
	{ id: "indigo", label: "Indigo", seed: { h: 268, c: 0.16 } },
	{ id: "blue", label: "Blue", seed: { h: 245, c: 0.15 } },
	{ id: "teal", label: "Teal", seed: { h: 195, c: 0.12 } },
	{ id: "green", label: "Green", seed: { h: 150, c: 0.12 } },
	{ id: "amber", label: "Amber", seed: { h: 75, c: 0.13 } },
	{ id: "rust", label: "Rust", seed: { h: 40, c: 0.14 } },
	{ id: "crimson", label: "Crimson", seed: { h: 15, c: 0.16 } },
	{ id: "magenta", label: "Magenta", seed: { h: 340, c: 0.16 } },
	{ id: "slate", label: "Slate", seed: { h: 250, c: 0.02 } },
] as const satisfies readonly {
	id: ThemeId;
	label: string;
	seed: Seed | null;
}[];

/** The tokens of one theme colour. */
export const themeTokens = (
	id: ThemeId,
	scheme: Scheme,
	contrast: Contrast,
): Tokens => {
	const seed = THEMES.find((theme) => theme.id === id)?.seed ?? null;
	return seed
		? seedTokens(seed, scheme, contrast)
		: farmerTokens(scheme, contrast);
};

/**
 * The web's tokens as the colour roles of the app. The screen background is
 * the web's ground, and a card or a list section is its island paper: the
 * same depth as the web, and as the grouped lists of iOS. The containers mix
 * the accent into the paper, as the web's `color-mix` tints do.
 */
export const paletteOf = (
	tokens: Tokens,
	scheme: Scheme,
	contrast: Contrast,
): Palette => {
	const dark = scheme === "dark";
	const high = contrast === "high";
	return {
		background: tokens.ground,
		surface: tokens.bg,
		// The farmer palette has two paper levels. The extra Material 3
		// surface roles are derived from them. Only Android screens read
		// them for now.
		surfaceDim: tokens.ground,
		surfaceBright: tokens.bg,
		surfaceContainerLowest: tokens.bg,
		surfaceContainerLow: tokens.bg,
		surfaceContainer: tokens.bg,
		surfaceContainerHigh: tokens.bg2,
		surfaceContainerHighest: mixHex(tokens.bg2, tokens.fg, 0.93),
		onSurface: tokens.fg,
		onSurfaceVariant: tokens.mut,
		primary: tokens.acc,
		// The web's `--primary-foreground` is the island paper.
		onPrimary: tokens.bg,
		primaryContainer: mixHex(tokens.acc, tokens.bg, dark ? 0.26 : 0.16),
		onPrimaryContainer: tokens.fg,
		secondary: mixHex(tokens.acc, tokens.mut, 0.45),
		onSecondary: tokens.bg,
		secondaryContainer: mixHex(tokens.acc, tokens.bg, dark ? 0.2 : 0.12),
		onSecondaryContainer: tokens.fg,
		tertiary: tokens.warn,
		onTertiary: tokens.bg,
		tertiaryContainer: mixHex(tokens.warn, tokens.bg, dark ? 0.24 : 0.16),
		onTertiaryContainer: mixHex(tokens.warn, tokens.fg, 0.45),
		inverseSurface: tokens.fg,
		inverseOnSurface: tokens.bg,
		// The accent on an inverse surface: lighter in light mode, darker
		// in dark mode.
		inversePrimary: dark
			? mixHex(tokens.acc, "#000000", 0.55)
			: mixHex(tokens.acc, "#ffffff", 0.45),
		scrim: "#000000",
		outline: high ? tokens.mut : tokens.faint,
		// The web's `--line`: the text colour at 11% (13% dark), and at 28%
		// (32% dark) in high contrast.
		outlineVariant: mixHex(
			tokens.fg,
			tokens.bg,
			high ? (dark ? 0.32 : 0.28) : dark ? 0.13 : 0.11,
		),
		error: tokens.bad,
		onError: tokens.bg,
		errorContainer: mixHex(tokens.bad, tokens.bg, dark ? 0.22 : 0.12),
		onErrorContainer: mixHex(tokens.bad, tokens.fg, 0.45),
		success: tokens.ok,
		successContainer: mixHex(tokens.ok, tokens.bg, dark ? 0.24 : 0.16),
		onSuccessContainer: mixHex(tokens.ok, tokens.fg, 0.45),
		warning: tokens.warn,
		warningContainer: mixHex(tokens.warn, tokens.bg, dark ? 0.24 : 0.16),
		onWarningContainer: mixHex(tokens.warn, tokens.fg, 0.45),
	};
};
