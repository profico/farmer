import { useCallback, useId, useRef } from "react";

import { QUICK_SEEDS, type Seed, SEED_MAX_CHROMA } from "#/lib/palette.ts";
import { cn } from "#/lib/utils.ts";

// Preferences → Display → Colors: the control that picks the seed the whole
// custom palette is derived from.
//
// A disc, because the seed IS two polar numbers and nothing else: the angle is
// the hue and the radius is the chroma. A pair of rectangular sliders would be
// the same two numbers with the relationship between them hidden, and a
// saturation/value square would offer a third — lightness — that this palette
// does not take, because every role's lightness is fixed so that contrast
// survives the choice (see `styles.css`, the custom palette).
//
// The quick seeds ring the disc at their own hue, so each one points at the
// part of the wheel it comes from and the ring reads as a legend for the disc
// rather than as a second, unrelated control.
//
// There is no preview swatch. The tokens are on <html>, so the app behind this
// control repaints as the thumb moves, and the app is a better preview of the
// app than a square is.

/** The lightness the disc is drawn at. Not the accent's own — a wheel at the
 *  accent's lightness reads as a dark ring in light mode and the hues stop
 *  telling each other apart. This is a step brighter, which is legible in both
 *  themes without claiming to be the color it produces. */
const WHEEL_L = 0.65;
/** What the rim is DRAWN at, which is no longer what the rim MEANS. The seed
 *  runs to `SEED_MAX_CHROMA`, and past 0.2 sRGB has nothing left to give at
 *  this lightness — a disc drawn to the seed's own ceiling would gamut-map its
 *  outer third into one flat band that reads as a rendering fault. So the disc
 *  ramps smoothly to the most color it can show, and its outer band is a
 *  legend rather than a swatch. What the rest of the intensity does is visible
 *  in the app behind this control, which is the better preview anyway. */
const WHEEL_C = 0.2;

/** The geometry, in px at scale 100%. The ring sits far enough out to clear the
 *  disc, and the box is large enough to hold a swatch and its selected ring. */
const DISC = 160;
const RING_RADIUS = 104;
const SWATCH = 24;
const BOX = 2 * (RING_RADIUS + SWATCH / 2 + 4);

/** The least angle two swatches may sit apart. A chord of `2 * RING_RADIUS *
 *  sin(gap / 2)` has to clear one swatch and leave a little air. */
const RING_MIN_GAP = 16;

/** Where each quick seed sits on the ring. The angle IS the seed's hue, so a
 *  swatch points at the part of the disc it comes from — except that Blue and
 *  Slate are five degrees apart and would be drawn on top of each other. Any
 *  pair closer than `RING_MIN_GAP` is pushed apart, both sides equally, until
 *  no pair is: every swatch keeps the side of the wheel it belongs to, and
 *  none of them moves further than it has to. Ten swatches need 160 of the 360
 *  degrees, so this always settles. */
const RING = (() => {
	const points = QUICK_SEEDS.map((quick) => ({
		label: quick.label,
		seed: quick.seed,
		angle: quick.seed.h,
	})).sort((a, b) => a.angle - b.angle);
	for (let pass = 0; pass < 200; pass += 1) {
		let settled = true;
		for (let i = 0; i < points.length; i += 1) {
			const here = points[i];
			const next = points[(i + 1) % points.length];
			if (!here || !next) continue;
			const gap = (next.angle - here.angle + 360) % 360;
			if (gap >= RING_MIN_GAP) continue;
			const push = (RING_MIN_GAP - gap) / 2;
			here.angle = (here.angle - push + 360) % 360;
			next.angle = (next.angle + push) % 360;
			settled = false;
		}
		if (settled) break;
	}
	return points;
})();

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

/** The same angle, in px on the ring rather than in percent of the disc. */
const toRingPoint = (angle: number) => {
	const radians = (angle * Math.PI) / 180;
	return {
		x: BOX / 2 + RING_RADIUS * Math.sin(radians),
		y: BOX / 2 - RING_RADIUS * Math.cos(radians),
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
		<div
			className={cn("relative", className)}
			style={{ width: BOX, height: BOX }}
		>
			{/* The keyboard and the screen reader read the seed as its two numbers,
			    because a disc is a pointer gesture and nothing else. They are off
			    screen rather than drawn: two sliders beside the wheel say the same
			    thing twice, and the wheel already says it better. Focus on either
			    one rings the disc, so tabbing to them is visible. */}
			<label className="sr-only" htmlFor={hueId}>
				Hue
			</label>
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
				className="peer/hue sr-only"
			/>
			<label className="sr-only" htmlFor={chromaId}>
				Intensity
			</label>
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
						c: round((Number(event.target.value) / 100) * SEED_MAX_CHROMA, 4),
					})
				}
				className="peer/chroma sr-only"
			/>

			{/* Pointer only, and hidden from the accessibility tree — the two inputs
			    above are what a keyboard and a screen reader get. */}
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
				className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 touch-none rounded-full ring-1 ring-line peer-focus-visible/hue:ring-2 peer-focus-visible/hue:ring-ring peer-focus-visible/chroma:ring-2 peer-focus-visible/chroma:ring-ring"
				style={{
					width: DISC,
					height: DISC,
					cursor: "crosshair",
					backgroundImage: [
						// Chroma: neutral at the centre, full at the rim.
						`radial-gradient(circle closest-side, oklch(${WHEEL_L} 0 0) 0%, transparent 100%)`,
						// Hue: `longer hue` between one color and itself is what walks
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
						// Drawn at what the disc can show, for the reason beside `WHEEL_C`.
						backgroundColor: `oklch(${WHEEL_L} ${Math.min(seed.c, WHEEL_C)} ${seed.h})`,
					}}
				/>
			</div>

			{/* Most people want a color, not a color space. */}
			{RING.map((quick) => {
				const point = toRingPoint(quick.angle);
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
							"absolute -translate-x-1/2 -translate-y-1/2 rounded-full ring-offset-2 ring-offset-background transition-transform duration-(--dur-fast) hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring",
							selected && "ring-2 ring-ring",
						)}
						style={{
							left: point.x,
							top: point.y,
							width: SWATCH,
							height: SWATCH,
							backgroundColor: `oklch(0.5174 ${quick.seed.c} ${quick.seed.h})`,
						}}
					/>
				);
			})}
		</div>
	);
}
