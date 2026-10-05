/**
 * Draws the app icon, the Android adaptive icon, the splash image and the
 * notification icon from the brand paths (`src/ui/brand-paths.ts`, copied
 * from the web's `Icon.svg`).
 *
 *   cd apps/mobile && bun run make-icons
 *
 * It needs ImageMagick 7 (`magick`) with the librsvg delegate, which draws
 * the gradient and the mask exactly. The output is committed, so run this
 * only after a change to the mark.
 *
 * The mark is a violet tile with the wheat ear CUT OUT of it: the ear is a
 * hole. An app icon has no ground to show through the hole, so here the ear
 * is drawn white on the violet gradient, as the mark reads on a light page.
 */
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { $ } from "bun";

import { MARK_GRADIENT, MARK_PATH } from "../src/ui/brand-paths";

const ASSETS = join(import.meta.dir, "..", "assets");

/** The tile is 82 units square, with corners of radius 17. */
const TILE = 82;
const RADIUS = 17;

/** The bounding box of the ear inside the tile, in tile units. */
const EAR = { x: 15, y: 4, size: 63 };

/** The far ends of the ear: the corner of the handle and the end of the
 *  stem. Their distance from the centre of the box decides how large the
 *  ear can be inside a round mask. */
const EAR_REACH = Math.hypot(78 - 15, 67.25 - 4.02) / 2;

const gradient = (id: string) => `
	<linearGradient id="${id}" x1="${MARK_GRADIENT.x1}" y1="${MARK_GRADIENT.y1}" x2="${MARK_GRADIENT.x2}" y2="${MARK_GRADIENT.y2}" gradientUnits="userSpaceOnUse">
		<stop offset="0" stop-color="${MARK_GRADIENT.from}"/>
		<stop offset="1" stop-color="${MARK_GRADIENT.to}"/>
	</linearGradient>`;

/**
 * The ear alone, in tile units, as a mask: the tile less the mark. The tile
 * in the mask is inset by a fraction of a unit, so the edge of the tile
 * leaves no hairline of antialiasing around the ear.
 *
 * `stem` continues the stem straight out past the corner of the tile, along
 * its two edges. The mark's stem runs out through the corner; on a square
 * icon the system's own corner mask then cuts it, as the tile's corner does.
 */
const earMask = (id: string, stem: boolean) => `
	<mask id="${id}" maskUnits="userSpaceOnUse" x="-20" y="-20" width="122" height="122">
		<rect x="0.6" y="0.6" width="${TILE - 1.2}" height="${TILE - 1.2}" rx="${RADIUS - 0.6}" fill="#fff"/>
		<path d="${MARK_PATH}" fill="#000"/>
		${stem ? '<path d="M74.833 4.585 L77.661 7.414 L107.661 -22.586 L104.833 -25.415 Z" fill="#fff"/>' : ""}
	</mask>`;

const svg = (size: number, body: string) =>
	`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${body}</svg>`;

/** The ear in `color`, scaled by `scale` and moved by `dx`, `dy`. */
const ear = (
	color: string,
	scale: number,
	dx: number,
	dy: number,
	stem: boolean,
) => `
	<defs>${earMask("ear", stem)}</defs>
	<g transform="translate(${dx} ${dy}) scale(${scale})">
		<rect x="-20" y="-20" width="122" height="122" fill="${color}" mask="url(#ear)"/>
	</g>`;

/** The ear centred in a square of `size`, with its far ends `reach` (a
 *  fraction of the side) from the centre. */
const centredEar = (size: number, reach: number, color: string) => {
	const scale = (reach * size) / EAR_REACH;
	const offset = (size - EAR.size * scale) / 2;
	return ear(
		color,
		scale,
		offset - EAR.x * scale,
		offset - EAR.y * scale,
		false,
	);
};

/** The tile's gradient over a full square, for a background. */
const gradientSquare = (size: number) => `
	<defs>${gradient("tile")}</defs>
	<g transform="scale(${size / TILE})">
		<rect width="${TILE}" height="${TILE}" fill="url(#tile)"/>
	</g>`;

const files: { name: string; size: number; svg: string }[] = [
	{
		// iOS and the legacy Android icon: the mark as it is drawn, full
		// bleed. The system rounds the corners.
		name: "icon.png",
		size: 1024,
		svg: svg(
			1024,
			gradientSquare(1024) + ear("#ffffff", 1024 / TILE, 0, 0, true),
		),
	},
	{
		// Android adaptive icon, front layer: the ear inside the safe zone,
		// the circle of 66 of the 108 units the launcher may show.
		name: "adaptive-icon.png",
		size: 1024,
		svg: svg(1024, centredEar(1024, 0.29, "#ffffff")),
	},
	{
		name: "adaptive-icon-background.png",
		size: 1024,
		svg: svg(1024, gradientSquare(1024)),
	},
	{
		// Android 13 themed icons: the launcher fills the shape with the
		// colour of the wallpaper.
		name: "adaptive-icon-monochrome.png",
		size: 1024,
		svg: svg(1024, centredEar(1024, 0.29, "#ffffff")),
	},
	{
		// The splash: the mark itself, the tile with the ear cut out. The
		// background colour of the splash shows through the ear.
		name: "splash-icon.png",
		size: 1024,
		svg: svg(
			1024,
			`<defs>${gradient("tile")}</defs>
			<g transform="scale(${1024 / TILE})">
				<path d="${MARK_PATH}" fill="${MARK_GRADIENT.from}"/>
				<path d="${MARK_PATH}" fill="url(#tile)"/>
			</g>`,
		),
	},
	{
		// The Android status bar draws only the alpha of this icon.
		name: "notification-icon.png",
		size: 96,
		svg: svg(96, centredEar(96, 0.45, "#ffffff")),
	},
];

/** The notification icon for each Android density: 24 dp. */
const DENSITIES = {
	mdpi: 24,
	hdpi: 36,
	xhdpi: 48,
	xxhdpi: 72,
	xxxhdpi: 96,
} as const;

for (const [density, size] of Object.entries(DENSITIES)) {
	files.push({
		name: `notification-icon/${density}.png`,
		size,
		svg: svg(size, centredEar(size, 0.45, "#ffffff")),
	});
}

const scratch = join(tmpdir(), `farmer-icons-${process.pid}`);
await mkdir(scratch, { recursive: true });
await mkdir(join(ASSETS, "notification-icon"), { recursive: true });

try {
	for (const file of files) {
		const source = join(scratch, file.name.replaceAll("/", "-") + ".svg");
		await Bun.write(source, file.svg);
		// No dates in the PNG, so a second run gives the same bytes.
		await $`magick -background none ${source} -strip -define png:exclude-chunks=date,time ${join(ASSETS, file.name)}`.quiet();
		console.log(`${file.name} (${file.size}px)`);
	}
} finally {
	await rm(scratch, { recursive: true, force: true });
}
