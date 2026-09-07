/**
 * One-off generator for the widescreen field art — the three tiling silhouettes
 * `components/field.tsx` uses as CSS masks. Run it by hand, commit the output:
 *
 *   bun run scripts/generate-field-art.ts
 *
 * It is a generator rather than three hand-drawn files because a field wants
 * fifty stalks that are all slightly different, and because the one thing that
 * makes the layers work — three tile widths that do not divide into each other,
 * so the repeat never lines up into a visible column — is a property of the
 * numbers rather than of the drawing.
 *
 * ---------------------------------------------------------------- contract ---
 * Anything obeying these four rules can replace an output file, including a
 * generated image. The CSS reads them as masks and nothing else:
 *
 *   1. Alpha carries the shape. The mask uses the alpha channel, so the art is
 *      an opaque silhouette on a fully transparent background. Colour is
 *      ignored: the layer is painted with `--field-tint` and the season decides
 *      that, which is what lets one asset serve winter and summer, light and
 *      dark. A shaded or coloured drawing loses its shading here and reads as a
 *      flat blob.
 *   2. It tiles horizontally. Nothing crosses the left or right edge, so the
 *      repeat has no seam. `mask-repeat: repeat-x`.
 *   3. It stands on the bottom edge. Every stalk runs to y = height with no gap
 *      below it, because the layer is anchored to the bottom of the flank.
 *   4. Its own top edge is empty. The layer is scaled by season, and a shape
 *      touching the top of the tile gets cropped rather than shortened.
 */

type Layer = {
	file: string;
	/** Tile width. Coprime-ish across the three, so the layers never beat. */
	width: number;
	height: number;
	stalks: number;
	/** Stalk height, as a fraction of the tile height. */
	minHeight: number;
	maxHeight: number;
	/** Half-width of a stem at the ground. */
	stemWidth: number;
	/** Sideways lean at the tip, as a fraction of the stalk height. */
	lean: number;
	/** Wheat carries an ear; grass does not. */
	ears: boolean;
};

// Three depths. Far is a low grass haze, near is the wheat you would touch.
const LAYERS: Layer[] = [
	{
		file: "crop-far.svg",
		width: 197,
		height: 120,
		stalks: 46,
		minHeight: 0.18,
		maxHeight: 0.34,
		stemWidth: 0.9,
		lean: 0.3,
		ears: false,
	},
	{
		file: "crop-mid.svg",
		width: 233,
		height: 120,
		stalks: 30,
		minHeight: 0.4,
		maxHeight: 0.66,
		stemWidth: 1.2,
		lean: 0.22,
		ears: true,
	},
	{
		file: "crop-near.svg",
		width: 281,
		height: 120,
		stalks: 21,
		minHeight: 0.66,
		maxHeight: 0.94,
		stemWidth: 1.7,
		lean: 0.16,
		ears: true,
	},
];

/** Seeded so a re-run reproduces the committed files byte for byte. */
const mulberry32 = (seed: number) => {
	let state = seed;
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
};

const round = (value: number) => Math.round(value * 100) / 100;

/**
 * A stem: a tapered ribbon from the ground to the tip, bowed towards the lean
 * so the whole field looks like it is standing in the same wind.
 */
const stem = (
	x: number,
	height: number,
	lean: number,
	width: number,
	tileHeight: number,
) => {
	const tipX = x + lean;
	const tipY = tileHeight - height;
	const tipWidth = width * 0.28;
	const bowX = x + lean * 0.3;
	const bowY = tileHeight - height * 0.5;
	return [
		`M${round(x - width)},${round(tileHeight)}`,
		`Q${round(bowX - width * 0.75)},${round(bowY)}`,
		`${round(tipX - tipWidth)},${round(tipY)}`,
		`L${round(tipX + tipWidth)},${round(tipY)}`,
		`Q${round(bowX + width * 0.75)},${round(bowY)}`,
		`${round(x + width)},${round(tileHeight)}`,
		"Z",
	].join(" ");
};

/**
 * The ear, as one almond aligned to the stem. Individual grains are invisible
 * at the size and opacity this renders at, so drawing them costs bytes and
 * buys nothing.
 */
const ear = (
	x: number,
	height: number,
	lean: number,
	width: number,
	tileHeight: number,
) => {
	const along = height * 0.155;
	const centreX = x + lean * 0.96;
	const centreY = tileHeight - height + along * 0.8;
	const degrees = round((Math.atan2(lean, height) * 180) / Math.PI);
	return (
		`<ellipse cx="${round(centreX)}" cy="${round(centreY)}" ` +
		`rx="${round(width * 1.7)}" ry="${round(along)}" ` +
		`transform="rotate(${degrees} ${round(centreX)} ${round(centreY)})"/>`
	);
};

const render = (layer: Layer): string => {
	// One seed per layer, from the tile width, so editing one layer leaves the
	// other two untouched in the diff.
	const random = mulberry32(layer.width * 7919);
	const crop: string[] = [];

	// A margin the width of the widest stalk keeps every shape clear of both
	// edges, which is rule 2 of the contract above.
	const margin = layer.stemWidth * 3;
	const span = layer.width - margin * 2;

	for (let index = 0; index < layer.stalks; index++) {
		// Evenly spaced, then jittered by up to half a slot: regular enough to
		// read as a planted field, irregular enough not to read as a comb.
		const slot = span / layer.stalks;
		const x = margin + slot * (index + 0.5) + (random() - 0.5) * slot * 0.9;
		const height =
			layer.height *
			(layer.minHeight + random() * (layer.maxHeight - layer.minHeight));
		const lean = height * layer.lean * (random() * 2 - 1);
		const width = layer.stemWidth * (0.75 + random() * 0.5);

		crop.push(`<path d="${stem(x, height, lean, width, layer.height)}"/>`);
		// Not every stalk in a wheat field is in ear; skipping some is what stops
		// the top edge reading as a dotted line.
		if (layer.ears && random() > 0.18) {
			crop.push(ear(x, height, lean, width, layer.height));
		}
	}

	return [
		`<svg xmlns="http://www.w3.org/2000/svg" width="${layer.width}" height="${layer.height}" viewBox="0 0 ${layer.width} ${layer.height}" fill="#fff">`,
		...crop,
		"</svg>",
		"",
	].join("\n");
};

const outDir = new URL("../public/field/", import.meta.url);
for (const layer of LAYERS) {
	const path = new URL(layer.file, outDir);
	await Bun.write(path, render(layer));
	console.log(`wrote public/field/${layer.file}`);
}
