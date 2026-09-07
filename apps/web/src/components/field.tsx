import { useFieldPhase } from "#/lib/field.ts";

/**
 * The field: crop rows standing on the ground behind the app frame, for the
 * screens wide enough to show any of it.
 *
 * It is decoration, and deliberately only decoration. It reads no data, so it
 * costs no query and cannot be wrong about your hours; the only things it knows
 * are the month and the hour, both in the org timezone, which pick a season and
 * a light (`lib/field.ts`). Everything else — the tint, the height of the crop,
 * the wind — is the `field` section of `styles.css`.
 *
 * There is no switch, so this renders on the server too, and the fade-in is a
 * CSS animation rather than a transition. A transition needs an old computed
 * value to run from; when the field arrived on hydration instead, the flip and
 * the first paint landed in one style recalculation and nothing faded at all.
 */
export function Field({ timezone }: { timezone: string }) {
	const { season, daylight } = useFieldPhase(timezone);

	return (
		<div
			className="field"
			data-season={season}
			data-daylight={daylight}
			aria-hidden="true"
		>
			{/* Three depths, back to front — the paint order is the depth order. */}
			<div className="field-ground">
				<span className="field-layer field-far" />
				<span className="field-layer field-mid" />
				<span className="field-layer field-near" />
			</div>
		</div>
	);
}
