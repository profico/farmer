import { ANIMATION_SPEEDS, type AnimationSpeed } from "#/lib/preferences.ts";
import { cn } from "#/lib/utils.ts";

const LABELS: Record<AnimationSpeed, string> = {
	instant: "Instant",
	nicer: "Slow it down",
	eyecandy: "Eye candy",
	whoa: "Whoa",
};

/**
 * A 4-stop slider for the animation-speed preference. A real (draggable,
 * keyboard-accessible) range input carries the interaction; the stop labels
 * below double as click targets for precise selection. The whole app reacts
 * live, so dragging this is its own preview.
 */
export function AnimationSpeedSlider({
	value,
	onChange,
}: {
	value: AnimationSpeed;
	onChange: (value: AnimationSpeed) => void;
}) {
	const index = Math.max(0, ANIMATION_SPEEDS.indexOf(value));
	const last = ANIMATION_SPEEDS.length - 1;

	return (
		<div className="max-w-md">
			<input
				type="range"
				min={0}
				max={last}
				step={1}
				value={index}
				onChange={(e) => onChange(ANIMATION_SPEEDS[Number(e.target.value)])}
				aria-label="Animation responsiveness"
				className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary"
			/>
			<div className="mt-2.5 flex justify-between text-xs">
				{ANIMATION_SPEEDS.map((speed) => (
					<button
						key={speed}
						type="button"
						onClick={() => onChange(speed)}
						className={cn(
							"-mx-1 rounded px-1 transition-colors",
							speed === value
								? "font-semibold text-foreground"
								: "text-muted-foreground hover:text-foreground",
						)}
					>
						{LABELS[speed]}
					</button>
				))}
			</div>
		</div>
	);
}
