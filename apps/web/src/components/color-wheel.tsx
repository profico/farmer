import { useCallback, useId, useRef } from "react";

import { QUICK_SEEDS, type Seed, SEED_MAX_CHROMA } from "#/lib/palette.ts";
import { cn } from "#/lib/utils.ts";

// Preferences → Display → Colours: the control that picks the seed the whole
// custom palette is derived from.
//
// A disc, because the seed IS two polar numbers and nothing else: the angle is
// the hue and the radius is the chroma. A pair of rectangular sliders would be
// the same two numbers with the relationship between them hidden, and a
// saturation/value square would offer a third — lightness — that this palette
// does not take, because every role's lightness is fixed so that contrast
// survives the choice (see `styles.css`, the custom palette).
//
// There is no preview swatch. The tokens are on <html>, so the app behind this
// control repaints as the thumb moves, and the app is a better preview of the
// app than a square is.

/** The lightness the disc is drawn at. Not the accent's own — a wheel at the
 *  accent's lightness reads as a dark ring in light mode and the hues stop
 *  telling each other apart. This is a step brighter, which is legible in both
 *  themes without claiming to be the colour it produces. */
const WHEEL_L = 0.65;
/** What the rim is drawn at. The disc shows chroma to its own edge, so the rim
 *  has to be the ceiling the seed is clamped to. */
const WHEEL_C = SEED_MAX_CHROMA;

/** Hue 0 sits at the top and increases clockwise, which is what a
 *  `conic-gradient` does by default, so the picture and the arithmetic below
 *  agree without either of them carrying an offset. */
const toPoint = (seed: Seed) => {
	const radians = (seed.h * Math.PI) / 180;
	const radius = Math.min(seed.c / SEED_MAX_CHROMA, 1);
	return {
		x: 50 + 50 * radius * Math.sin(radians),
		y: 50 - 50 * radius * Math.cos(radians),
	};
};

const round = (value: number, places: number) => {
	const factor = 10 ** places;
	return Math.round(value * factor) / factor;
};

export function ColorWheel({
	seed,
	onChange,
	className,
}: {
	seed: Seed;
	onChange: (seed: Seed) => void;
	className?: string;
}) {
	const discRef = useRef<HTMLDivElement>(null);
	const hueId = useId();
	const chromaId = useId();

	// `getBoundingClientRect` and `clientX` are both in the zoomed coordinate
	// space, so this needs no correction for Preferences → Display → Scale —
	// unlike a viewport length, which is not. See `--svh` in `styles.css`.
	const pick = useCallback(
		(clientX: number, clientY: number) => {
			const disc = discRef.current;
			if (!disc) return;
			const box = disc.getBoundingClientRect();
			const dx = clientX - (box.left + box.width / 2);
			const dy = clientY - (box.top + box.height / 2);
			const radius = Math.min(
				Math.hypot(dx, dy) / (Math.min(box.width, box.height) / 2),
				1,
			);
			// Dead centre has no angle to read, so the hue is left where it was
			// rather than snapping to whichever way the last pixel of travel went.
			const h =
				dx === 0 && dy === 0
					? seed.h
					: ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
			onChange({ h: round(h, 1), c: round(radius * SEED_MAX_CHROMA, 4) });
		},
		[onChange, seed.h],
	);

	const thumb = toPoint(seed);

	return (
		<div className={cn("flex flex-wrap items-start gap-5", className)}>
			{/* Pointer only. The two sliders beside it are the keyboard and the
			    screen reader's way in, and they are visible rather than hidden
			    because fine adjustment wants them too. */}
			<div
				ref={discRef}
				aria-hidden
				onPointerDown={(event) => {
					event.currentTarget.setPointerCapture(event.pointerId);
					pick(event.clientX, event.clientY);
				}}
				onPointerMove={(event) => {
					if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
					pick(event.clientX, event.clientY);
				}}
				className="relative size-40 shrink-0 touch-none rounded-full ring-1 ring-line"
				style={{
					cursor: "crosshair",
					backgroundImage: [
						// Chroma: neutral at the centre, full at the rim.
						`radial-gradient(circle closest-side, oklch(${WHEEL_L} 0 0) 0%, transparent 100%)`,
						// Hue: `longer hue` between one colour and itself is what walks
						// the whole wheel in a single stop pair.
						`conic-gradient(in oklch longer hue, oklch(${WHEEL_L} ${WHEEL_C} 0), oklch(${WHEEL_L} ${WHEEL_C} 360))`,
					].join(", "),
				}}
			>
				<span
					className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white shadow-[var(--shadow-pop)]"
					style={{
						left: `${thumb.x}%`,
						top: `${thumb.y}%`,
						backgroundColor: `oklch(${WHEEL_L} ${seed.c} ${seed.h})`,
					}}
				/>
			</div>

			<div className="flex min-w-56 flex-1 flex-col gap-3">
				<label className="flex flex-col gap-1.5" htmlFor={hueId}>
					<span className="text-sm text-muted-foreground">Hue</span>
					<input
						id={hueId}
						type="range"
						min={0}
						max={359}
						step={1}
						value={Math.round(seed.h)}
						onChange={(event) =>
							onChange({ ...seed, h: Number(event.target.value) })
						}
						className="w-full accent-[var(--acc)]"
					/>
				</label>

				<label className="flex flex-col gap-1.5" htmlFor={chromaId}>
					<span className="text-sm text-muted-foreground">Intensity</span>
					<input
						id={chromaId}
						type="range"
						min={0}
						max={100}
						step={1}
						value={Math.round((seed.c / SEED_MAX_CHROMA) * 100)}
						onChange={(event) =>
							onChange({
								...seed,
								c: round(
									(Number(event.target.value) / 100) * SEED_MAX_CHROMA,
									4,
								),
							})
						}
						className="w-full accent-[var(--acc)]"
					/>
				</label>

				{/* Most people want a colour, not a colour space. */}
				<div className="flex flex-wrap gap-1.5 pt-1">
					{QUICK_SEEDS.map((quick) => {
						const selected =
							Math.round(quick.seed.h) === Math.round(seed.h) &&
							Math.abs(quick.seed.c - seed.c) < 0.005;
						return (
							<button
								key={quick.label}
								type="button"
								aria-label={quick.label}
								title={quick.label}
								onClick={() => onChange(quick.seed)}
								className={cn(
									"size-6 rounded-full ring-offset-2 ring-offset-background transition-shadow duration-(--dur-fast)",
									selected && "ring-2 ring-ring",
								)}
								style={{
									backgroundColor: `oklch(0.5174 ${quick.seed.c} ${quick.seed.h})`,
								}}
							/>
						);
					})}
				</div>
			</div>
		</div>
	);
}
