import { useEffect, useRef } from "react";

import { useFieldPhase } from "#/lib/field.ts";
import { mountWheatField, type WheatField } from "#/lib/wheat-field.ts";

/** The canvas's height in CSS pixels. `.field-crop` sets the same. */
const HEIGHT = 300;

/** A custom property off the canvas, as a number. */
const readNumber = (element: Element, name: string, fallback: number) => {
	const value = Number.parseFloat(
		getComputedStyle(element).getPropertyValue(name),
	);
	return Number.isFinite(value) ? value : fallback;
};

/**
 * The field: crop rows standing on the ground behind the app frame, for the
 * screens wide enough to show any of it.
 *
 * It is decoration, and deliberately only decoration. It reads no data, so it
 * costs no query and cannot be wrong about your hours; the only things it knows
 * are the month and the hour, both in the org timezone, which pick a season and
 * a light (`lib/field.ts`). The tint, the height of the crop and the width gate
 * are the `field` section of `styles.css`; the stalks are the same wheat as the
 * public site's footer (`lib/wheat-field.ts`), in one color and without the
 * pointer wind or the gusts, so it never pulls the eye off the work.
 *
 * There is no switch, so this renders on the server too, and the fade-in is a
 * CSS animation rather than a transition. A transition needs an old computed
 * value to run from; when the field arrived on hydration instead, the flip and
 * the first paint landed in one style recalculation and nothing faded at all.
 */
export function Field({ timezone }: { timezone: string }) {
	const { season, daylight } = useFieldPhase(timezone);
	const ref = useRef<HTMLCanvasElement>(null);
	const field = useRef<WheatField | null>(null);

	useEffect(() => {
		const canvas = ref.current;
		if (!canvas) return;
		field.current = mountWheatField(canvas, {
			height: HEIGHT,
			seed: 11,
			density: 9,
			shortest: 90,
			tallest: 260,
			tone: "--field-tint",
			accent: "--field-tint",
			accentShare: 0,
			opacity: [0.7, 1],
			// Only the sway: a background behind the work does not gust.
			wind: false,
			gusts: false,
			heightScale: () => readNumber(canvas, "--field-scale", 1),
			// The width gate is the one media query in `styles.css`; it sets
			// `--field-live`, so the breakpoint is not written a second time here.
			active: () => readNumber(canvas, "--field-live", 0) === 1,
		});
		return () => {
			field.current?.dispose();
			field.current = null;
		};
	}, []);

	// A new season changes the tint and the height of the crop.
	useEffect(() => {
		field.current?.refresh();
	}, [season, daylight]);

	return (
		<div
			className="field"
			data-season={season}
			data-daylight={daylight}
			aria-hidden="true"
		>
			<div className="field-ground">
				<canvas ref={ref} className="field-crop" />
			</div>
		</div>
	);
}
