// Colour arithmetic for the themes: OKLCH to sRGB hex, and a mix of two hex
// colours. The web app does the same work in CSS (`oklch()` and
// `color-mix(in srgb, ...)` in `apps/web/src/styles.css`); React Native has
// neither, so the app computes the hex values itself.

export type Oklch = { l: number; c: number; h: number };

const clamp = (value: number, min: number, max: number) =>
	Math.min(Math.max(value, min), max);

/** Linear sRGB channel to the gamma-encoded 0..1 value. */
const encode = (channel: number) =>
	channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055;

const decode = (channel: number) =>
	channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;

const toHex = (channels: readonly number[]) =>
	`#${channels
		.map((channel) =>
			Math.round(clamp(channel, 0, 1) * 255)
				.toString(16)
				.padStart(2, "0"),
		)
		.join("")}`;

/**
 * OKLCH to an sRGB hex. A colour outside the sRGB gamut is clipped per
 * channel, as the web's contrast check (`check-palette-contrast.ts`) models
 * the browser, so a seed gives the same hex here as on the web.
 */
export const oklchToHex = ({ l, c, h }: Oklch) => {
	const radians = (h * Math.PI) / 180;
	const a = c * Math.cos(radians);
	const b = c * Math.sin(radians);
	const lms = [
		(l + 0.3963377774 * a + 0.2158037573 * b) ** 3,
		(l - 0.1055613458 * a - 0.0638541728 * b) ** 3,
		(l - 0.0894841775 * a - 1.291485548 * b) ** 3,
	] as const;
	const [lc, mc, sc] = lms;
	return toHex(
		[
			4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc,
			-1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc,
			-0.0041960863 * lc - 0.7034186147 * mc + 1.707614701 * sc,
		].map((channel) => encode(clamp(channel, 0, 1))),
	);
};

const channelsOf = (hex: string) => {
	const value = Number.parseInt(hex.slice(1, 7), 16);
	return [(value >> 16) & 255, (value >> 8) & 255, value & 255].map(
		(channel) => channel / 255,
	);
};

/**
 * `color-mix(in srgb, a weight, b)`: `weight` of `a` over `b`, in the
 * gamma-encoded space, as the web's `color-mix(in srgb, ...)` does. The
 * result is opaque, so it is the colour of `a` at that opacity over `b`.
 */
export const mixHex = (a: string, b: string, weight: number) => {
	const from = channelsOf(a);
	const to = channelsOf(b);
	return toHex(
		from.map(
			(channel, index) => channel * weight + (to[index] ?? 0) * (1 - weight),
		),
	);
};

/** WCAG 2 contrast ratio of two hex colours. */
export const contrastRatio = (a: string, b: string) => {
	const luminance = (hex: string) => {
		const [r = 0, g = 0, bl = 0] = channelsOf(hex).map(decode);
		return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
	};
	const la = luminance(a);
	const lb = luminance(b);
	return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

/** An sRGB hex to OKLCH. The inverse of `oklchToHex`, for a colour that
 *  comes from a native scheme and needs a hue turn. */
export const hexToOklch = (hex: string): Oklch => {
	const [r = 0, g = 0, b = 0] = channelsOf(hex).map(decode);
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
	const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
	const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
	const hue = (Math.atan2(bb, a) * 180) / Math.PI;
	return {
		l: lightness,
		c: Math.hypot(a, bb),
		h: ((hue % 360) + 360) % 360,
	};
};
