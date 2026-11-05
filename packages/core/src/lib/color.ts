import { z } from "zod";

// A stored task color is a `#rrggbb` hex (the picker) or a lowercase color
// name (rows from the built-in seeds, such as "green"). Anything else, such
// as `;` or `url(...)`, can add CSS declarations when a page draws it.
const COLOR_PATTERN = /^(#[0-9a-f]{6}|[a-z]{3,20})$/i;

export const hexColor = z
	.string()
	.regex(COLOR_PATTERN, "Use a #rrggbb color or a color name");

export const isSafeColor = (value: string): boolean =>
	COLOR_PATTERN.test(value);

/** The color to draw: the stored value only if it is safe, else `fallback`. */
export const safeColor = (
	value: string | null | undefined,
	fallback = "var(--muted-foreground)",
): string => (value && isSafeColor(value) ? value : fallback);
