import { animate, useReducedMotion } from "motion/react";
import { useEffect, useRef } from "react";

/**
 * A figure that counts up from zero the first time it is painted and tweens
 * between values after that, so a total that changes when an entry is saved
 * moves rather than jumps.
 *
 * The number is written straight into the span on every frame rather than
 * through state: sixty renders a second of a formatted string is the kind of
 * thing that makes a home page feel heavy, and nothing else on the screen
 * reads the intermediate value. Under reduced motion, or the app's own "Less
 * movement" switch, the final value is written once.
 *
 * `format` is called on fractional values mid-flight, so it has to round —
 * every formatter in `lib/format-hours.ts` and `report-format.ts` does.
 */
export function CountUp({
	value,
	format,
	duration = 0.5,
	className,
}: {
	value: number;
	format: (value: number) => string;
	/** Seconds. */
	duration?: number;
	className?: string;
}) {
	const ref = useRef<HTMLSpanElement>(null);
	const previous = useRef<number | null>(null);
	const reduced = useReducedMotion();

	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		const from = previous.current ?? 0;
		previous.current = value;
		const still =
			reduced ||
			document.documentElement.getAttribute("data-motion") === "reduce" ||
			from === value;
		if (still) {
			el.textContent = format(value);
			return;
		}
		const controls = animate(from, value, {
			duration,
			ease: [0.23, 1, 0.32, 1],
			onUpdate: (v) => {
				el.textContent = format(v);
			},
		});
		return () => controls.stop();
	}, [value, format, duration, reduced]);

	// Server-rendered and first-painted at the final value, so a cold load
	// never shows a zero before hydration; the effect then rewinds and counts.
	return (
		<span ref={ref} className={className}>
			{format(value)}
		</span>
	);
}
