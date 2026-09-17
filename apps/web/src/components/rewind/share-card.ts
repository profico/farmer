import type { Rewind } from "@farmer/core/services";

import { summaryTiles, THEMES } from "./slides.tsx";

// The picture a person shares: the summary slide redrawn on a canvas at a
// story's size, so it can go to a phone's share sheet as a file. Drawn by
// hand rather than screenshotted, because the slide on screen is sized to
// whatever window it is in.

const W = 1080;

const H = 1920;

const PAD = 90;

const SERIF = '"Instrument Serif", ui-serif, Georgia, serif';

const SANS = '"Instrument Sans", ui-sans-serif, system-ui, sans-serif';

const MONO = '"Geist Mono", ui-monospace, monospace';

const rgba = (hex: string, alpha: number): string => {
	const n = Number.parseInt(hex.slice(1), 16);

	return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
};

/** Writes `text` in the largest size from `max` down to `min` that fits
 *  `width`, and cuts it with an ellipsis if even `min` does not. */
const fitText = (
	ctx: CanvasRenderingContext2D,
	text: string,
	x: number,
	y: number,
	width: number,
	max: number,
	min: number,
) => {
	let size = max;
	ctx.font = `400 ${size}px ${SERIF}`;

	while (size > min && ctx.measureText(text).width > width) {
		size -= 4;
		ctx.font = `400 ${size}px ${SERIF}`;
	}

	let shown = text;

	while (shown.length > 1 && ctx.measureText(shown).width > width) {
		shown = shown.slice(0, -1);

		if (ctx.measureText(`${shown}…`).width <= width) {
			shown = `${shown}…`;
			break;
		}
	}

	ctx.fillText(shown, x, y);
};

const glow = (
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	radius: number,
	color: string,
	alpha: number,
) => {
	const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
	gradient.addColorStop(0, rgba(color, alpha));
	gradient.addColorStop(1, rgba(color, 0));
	ctx.fillStyle = gradient;
	ctx.fillRect(0, 0, W, H);
};

export async function drawShareCard(
	rewind: Rewind,
	firstName: string,
): Promise<Blob> {
	// A canvas draws with whatever font is loaded at that moment, and falls
	// back silently, so the faces are asked for first.
	await Promise.all([
		document.fonts.load(`400 88px ${SERIF}`),
		document.fonts.load(`500 30px ${SANS}`),
		document.fonts.load(`400 30px ${MONO}`),
	]);

	const theme = THEMES.ink;
	const canvas = document.createElement("canvas");
	canvas.width = W;
	canvas.height = H;
	const ctx = canvas.getContext("2d");

	if (!ctx) throw new Error("Canvas is not available.");

	ctx.fillStyle = theme.bg;
	ctx.fillRect(0, 0, W, H);
	glow(ctx, W - 160, 260, 760, theme.accent, 0.3);
	glow(ctx, 140, H - 180, 640, theme.fg, 0.07);

	ctx.fillStyle = theme.fg;
	ctx.textBaseline = "alphabetic";

	ctx.globalAlpha = 0.75;
	ctx.font = `500 32px ${SANS}`;
	ctx.letterSpacing = "6px";
	ctx.fillText("FARMER REWIND", PAD, 330);
	ctx.letterSpacing = "0px";

	ctx.globalAlpha = 1;
	ctx.fillStyle = theme.accent;
	ctx.font = `400 380px ${SERIF}`;
	ctx.fillText(String(rewind.year), PAD - 12, 670);

	ctx.fillStyle = theme.fg;
	ctx.globalAlpha = 0.85;
	ctx.font = `400 46px ${SANS}`;
	ctx.fillText(
		`${firstName}, this was your year in hours.`,
		PAD,
		770,
		W - PAD * 2,
	);
	ctx.globalAlpha = 1;

	// The tiles: two columns, three rows, ruled like the slide.
	const tiles = summaryTiles(rewind);
	const top = 880;
	const gridW = W - PAD * 2;
	const tileW = gridW / 2;
	const tileH = 250;
	const rows = Math.ceil(tiles.length / 2);

	ctx.strokeStyle = rgba(theme.fg, 0.2);
	ctx.lineWidth = 2;
	ctx.beginPath();
	ctx.roundRect(PAD, top, gridW, tileH * rows, 36);
	ctx.stroke();
	ctx.beginPath();
	ctx.moveTo(PAD + tileW, top);
	ctx.lineTo(PAD + tileW, top + tileH * rows);

	for (let row = 1; row < rows; row++) {
		ctx.moveTo(PAD, top + tileH * row);
		ctx.lineTo(PAD + gridW, top + tileH * row);
	}

	ctx.stroke();

	tiles.forEach((tile, i) => {
		const x = PAD + (i % 2) * tileW + 48;
		const y = top + Math.floor(i / 2) * tileH;
		ctx.globalAlpha = 0.6;
		ctx.font = `500 26px ${SANS}`;
		ctx.letterSpacing = "4px";
		ctx.fillText(tile.label.toUpperCase(), x, y + 84);
		ctx.letterSpacing = "0px";
		ctx.globalAlpha = 1;
		fitText(ctx, tile.value, x, y + 190, tileW - 96, 88, 56);
	});

	ctx.globalAlpha = 0.5;
	ctx.font = `400 30px ${MONO}`;
	ctx.fillText("farmer", PAD, H - 110);
	ctx.globalAlpha = 1;

	return new Promise((resolve, reject) => {
		canvas.toBlob(
			(blob) =>
				blob ? resolve(blob) : reject(new Error("The image was not made.")),
			"image/png",
		);
	});
}

/** Hands the card to the device's share sheet where it takes files (most
 *  phones), and saves it as a download everywhere else. */
export async function shareRewindCard(
	rewind: Rewind,
	firstName: string,
): Promise<"shared" | "downloaded" | "cancelled"> {
	const blob = await drawShareCard(rewind, firstName);
	const name = `farmer-rewind-${rewind.year}.png`;
	const file = new File([blob], name, { type: "image/png" });

	if (navigator.canShare?.({ files: [file] })) {
		try {
			await navigator.share({
				files: [file],
				title: `My ${rewind.year} Farmer Rewind`,
			});

			return "shared";
		} catch (error) {
			// Closing the share sheet is a choice, not a failure.
			if (error instanceof DOMException && error.name === "AbortError") {
				return "cancelled";
			}

			throw error;
		}
	}

	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = name;
	link.click();
	// The click has started the download; the URL is no longer needed.
	setTimeout(() => URL.revokeObjectURL(url), 1000);

	return "downloaded";
}
