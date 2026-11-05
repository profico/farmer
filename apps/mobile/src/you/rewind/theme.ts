import { Platform } from "react-native";

import type { SlideKind } from "./story";

// The colours of a Rewind. They are fixed, not from the theme of the app:
// a Rewind is an occasion, and it looks the same in light and dark mode.
// They are the colours of the web Rewind (`components/rewind/slides.tsx`),
// so a slide on the phone and on the web look the same.

export type RewindTheme = { bg: string; fg: string; accent: string };

export const THEMES = {
	violet: { bg: "#5b3aa8", fg: "#fbf8ff", accent: "#ffd27a" },
	ink: { bg: "#15130f", fg: "#f3efe6", accent: "#b69cff" },
	moss: { bg: "#27513d", fg: "#eef5ea", accent: "#f6c85f" },
	amber: { bg: "#f0b43c", fg: "#1b1a17", accent: "#5b3aa8" },
	coral: { bg: "#cf553f", fg: "#fff6f1", accent: "#1b1a17" },
	cobalt: { bg: "#22418f", fg: "#eef2ff", accent: "#ffb86b" },
	paper: { bg: "#f6f2ea", fg: "#1b1a17", accent: "#5b3aa8" },
} as const satisfies { [name: string]: RewindTheme };

/** The colours of each slide, in the order of the web. */
export const SLIDE_THEMES = {
	intro: THEMES.violet,
	empty: THEMES.ink,
	hours: THEMES.ink,
	days: THEMES.moss,
	months: THEMES.amber,
	bigDay: THEMES.coral,
	projects: THEMES.cobalt,
	tasks: THEMES.paper,
	words: THEMES.violet,
	github: THEMES.ink,
	timeOff: THEMES.moss,
	persona: THEMES.amber,
	summary: THEMES.ink,
} as const satisfies { [kind in SlideKind]: RewindTheme };

/** The colours of the shares of the year by task group. */
export const GROUP_COLORS = [
	"#5b3aa8",
	"#cf553f",
	"#27513d",
	"#f0b43c",
	"#22418f",
] as const;

/** True for a slide with dark text, which needs a dark status bar. */
export const isLight = (theme: RewindTheme) => theme.fg === "#1b1a17";

/** A colour with an alpha, from "#rrggbb" and a value from 0 to 1. */
export const withAlpha = (hex: string, alpha: number) =>
	`${hex}${Math.round(alpha * 255)
		.toString(16)
		.padStart(2, "0")}`;

/** The serif names the moment, and the monospace carries the number, as on
 *  the web. Both are system fonts. */
export const SERIF = Platform.select({ ios: "Georgia", default: "serif" });
export const MONO = Platform.select({ ios: "Menlo", default: "monospace" });
