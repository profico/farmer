// Wheat drawn on a canvas: rows of stalks that sway, bend in a gust now and
// then, and — where it is switched on — bend away from the pointer. The public
// site's footer (`components/site/wheat-field.tsx`) and the dashboard's
// widescreen field (`components/field.tsx`) are two sets of options on this.
//
// A canvas, not SVG or CSS. As SVG every stalk was a node with its own CSS
// animation, so the browser repainted the whole field on every frame and the
// wind lagged. Here one frame loop draws the stalks from shapes built once, and
// it only runs while the field is on screen and something moves.
//
// The field is laid out in CSS pixels across the canvas's real width, so a
// stalk is the same size on any screen; a wider canvas grows more of them. The
// seed is fixed, so a field is the same on every visit.

export type WheatFieldOptions = {
	/** The canvas's height in CSS pixels; the stalks stand on its bottom edge.
	 *  The CSS must set the same height. */
	height: number;
	seed: number;
	/** Stalks per 100px in the front row. */
	density: number;
	/** Stalk heights, in CSS pixels, before `heightScale`. Heads and stems grow
	 *  with `tallest`, so a taller field is not a spindly one. */
	shortest: number;
	tallest: number;
	/** The custom property each stalk is painted with. */
	tone: string;
	/** The custom property for the accent stalks, and their share. A share of 0
	 *  gives a monochrome field. */
	accent: string;
	accentShare: number;
	/** The range each stalk's opacity is drawn from, before the row's fade. */
	opacity: readonly [number, number];
	/** Bend away from the pointer while it is over the canvas. */
	wind: boolean;
	/** Send a gust across the field now and then, the first one soon after
	 *  the field comes into view. */
	gusts: boolean;
	/** A multiplier on every stalk's height, read again on `refresh()`. Under
	 *  one half the crop is stubble and grows no heads. */
	heightScale?: () => number;
	/** Whether the field is showing at all, read again on every resize. While
	 *  false the field is drawn once and never animated. */
	active?: () => boolean;
};

export type WheatField = {
	/** Reads the colors, `heightScale` and `active` again and redraws. */
	refresh: () => void;
	dispose: () => void;
};

/** Rows, back to front. The back row is shorter, fainter and denser, which
 *  gives the field its distance. */
const ROWS = 3;
/** The share of stalks with no head. */
const BARE_SHARE = 0.28;
/** The idle sway's reach either side of upright, in degrees. */
const SWAY_DEGREES = 1.5;
/** The sway is slow enough that 30 frames a second look the same as 60, and
 *  a dashboard left open all day pays half as much for it. Wind and gusts
 *  still get every frame. */
const SWAY_FRAME_MS = 1000 / 30;
/** How far from the pointer the wind reaches, in CSS pixels. */
const WIND_REACH = 130;
/** The most the pointer bends a stalk, in degrees. */
const WIND_DEGREES = 16;
/** The wind's spring: a little under-damped, so a stalk overshoots once and
 *  settles, the way a real one does. */
const WIND_OMEGA = (2 * Math.PI) / 0.55;
const WIND_DAMPING = 0.45;
/** Now and then a gust crosses the whole field: a front that travels from one
 *  edge to the other and bends each stalk it passes. The same spring then
 *  brings every stalk back. */
const GUST_EVERY_MS = [9000, 18000] as const;
/** The first gust after the field comes into view comes sooner, so a reader
 *  who stops at it sees one. */
const FIRST_GUST_MS = [2500, 5000] as const;
const GUST_DEGREES = 9;
/** How wide the front is, and how fast it travels, in CSS pixels. */
const GUST_WIDTH = 220;
const GUST_SPEED = 650;
/** The height `tallest` is measured against for the size of heads and stems. */
const REFERENCE_HEIGHT = 140;

const RADIANS = Math.PI / 180;

type Stalk = {
	x: number;
	accent: boolean;
	opacity: number;
	width: number;
	/** The stem, in the stalk's own frame: the base at (0, 0), up is -y, so a
	 *  rotation about the origin bends it from the ground. */
	stem: Path2D;
	grains: Path2D;
	/** The idle sway: a slow sine, each stalk on its own phase and period. */
	phase: number;
	period: number;
	/** The wind's bend, in degrees, and its spring's velocity. */
	angle: number;
	velocity: number;
};

/** A seeded generator (Park–Miller), so the field is the same every visit. */
const seeded = (seed: number) => {
	let state = seed;
	return () => {
		state = (state * 16807) % 2147483647;
		return (state - 1) / 2147483646;
	};
};

const between = (
	[low, high]: readonly [number, number],
	random = Math.random,
) => low + random() * (high - low);

function growField(
	options: WheatFieldOptions,
	width: number,
	heightScale: number,
): Stalk[] {
	const random = seeded(options.seed);
	const size = options.tallest / REFERENCE_HEIGHT;
	const bareShare = heightScale < 0.5 ? 1 : BARE_SHARE;
	const stalks: Stalk[] = [];
	for (let row = 0; row < ROWS; row++) {
		const depth = row / (ROWS - 1);
		const scale = (0.55 + depth * 0.45) * size;
		const fade = 0.35 + depth * 0.65;
		const step = (100 / options.density) * (0.7 + depth * 0.5);
		for (
			let x = 4 + random() * step;
			x < width;
			x += step * (0.6 + random() * 0.8)
		) {
			const height =
				between([options.shortest, options.tallest], random) *
				(0.55 + depth * 0.45) *
				heightScale;
			const lean = (random() - 0.5) * 22 * size;
			const accent = random() < options.accentShare;
			const opacity = between(options.opacity, random) * fade;
			const stem = new Path2D();
			stem.moveTo(0, 0);
			stem.quadraticCurveTo(lean * 0.2, -height * 0.5, lean, -height);
			const grains = new Path2D();
			if (random() > bareShare) {
				const count = 5 + Math.floor(random() * 4);
				const tilt = 24 * RADIANS;
				for (let k = 0; k < count; k++) {
					const y = -height + (4 + k * 5.2) * scale;
					const rx = 1.7 * scale;
					const ry = 4 * scale;
					grains.ellipse(lean - 2.6 * scale, y, rx, ry, -tilt, 0, Math.PI * 2);
					grains.ellipse(lean + 2.6 * scale, y, rx, ry, tilt, 0, Math.PI * 2);
				}
			}
			stalks.push({
				x,
				accent,
				opacity,
				width: 1.1 * scale,
				stem,
				grains,
				phase: random() * Math.PI * 2,
				period: 12 + random() * 4,
				angle: 0,
				velocity: 0,
			});
		}
	}
	return stalks;
}

/** "Less movement" in Preferences → Display, or the system's own setting. */
const holdStill = () =>
	document.documentElement.getAttribute("data-motion") === "reduce" ||
	window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function mountWheatField(
	canvas: HTMLCanvasElement,
	options: WheatFieldOptions,
): WheatField | null {
	const ctx = canvas.getContext("2d");
	if (!ctx) return null;
	const { height } = options;
	let stalks: Stalk[] = [];
	let fieldWidth = 0;
	let heightScale = 1;
	let enabled = true;
	let dpr = 1;
	let colors = { tone: "", accent: "" };
	let visible = false;
	let frame = 0;
	let last = 0;
	let lastDrawn = 0;
	let pointerX: number | null = null;
	let previousX: number | null = null;
	let pointerVelocity = 0;
	/** The canvas's left edge in the viewport. Only a resize moves it
	 *  sideways, so it is read once per hover. */
	let left: number | null = null;
	// Set when the field comes into view; a gust never blows unseen.
	let nextGust = Number.POSITIVE_INFINITY;
	/** The gust crossing now: when it set off, and which way it blows. */
	let gust: { start: number; direction: 1 | -1 } | null = null;

	// The tokens can be `oklch(…)` with a `calc()` inside, which a canvas does
	// not parse. Setting one as the element's color and reading it back gets
	// the browser's resolved value.
	const resolve = (token: string) => {
		canvas.style.color = `var(${token})`;
		return getComputedStyle(canvas).color;
	};
	const readColors = () => {
		colors = { tone: resolve(options.tone), accent: resolve(options.accent) };
	};

	const draw = (now: number) => {
		lastDrawn = now;
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		const sway = holdStill() ? 0 : SWAY_DEGREES * RADIANS;
		const seconds = now / 1000;
		ctx.lineCap = "round";
		for (const stalk of stalks) {
			const angle =
				sway * Math.sin((seconds / stalk.period) * Math.PI * 2 + stalk.phase) +
				stalk.angle * RADIANS;
			const cos = Math.cos(angle) * dpr;
			const sin = Math.sin(angle) * dpr;
			ctx.setTransform(cos, sin, -sin, cos, stalk.x * dpr, height * dpr);
			ctx.globalAlpha = stalk.opacity;
			const tone = stalk.accent ? colors.accent : colors.tone;
			ctx.strokeStyle = tone;
			ctx.fillStyle = tone;
			ctx.lineWidth = stalk.width;
			ctx.stroke(stalk.stem);
			ctx.fill(stalk.grains);
		}
	};

	/** Where the gust's front is now, or null once it has left the field. */
	const gustFront = (now: number) => {
		if (!gust) return null;
		const travelled = ((now - gust.start) / 1000) * GUST_SPEED;
		if (travelled > fieldWidth + 2 * GUST_WIDTH) return null;
		return gust.direction > 0
			? travelled - GUST_WIDTH
			: fieldWidth + GUST_WIDTH - travelled;
	};

	/** Moves every wind spring one step; true while any is still moving. */
	const blow = (dt: number, now: number) => {
		if (options.gusts && !gust && now >= nextGust && !holdStill()) {
			gust = { start: now, direction: Math.random() < 0.7 ? 1 : -1 };
			nextGust = now + between(GUST_EVERY_MS);
		}
		const front = gustFront(now);
		if (front === null) gust = null;
		let moving = front !== null;
		for (const stalk of stalks) {
			let target = 0;
			if (gust && front !== null) {
				const offset = (stalk.x - front) / GUST_WIDTH;
				target += gust.direction * GUST_DEGREES * Math.exp(-offset * offset);
			}
			if (pointerX !== null) {
				const distance = stalk.x - pointerX;
				const fall = Math.max(0, 1 - Math.abs(distance) / WIND_REACH);
				target +=
					Math.sign(distance) * fall * fall * WIND_DEGREES +
					pointerVelocity * fall * 0.04;
			}
			if (Math.abs(target) < 0.01 && stalk.angle === 0 && stalk.velocity === 0)
				continue;
			const acceleration =
				-2 * WIND_DAMPING * WIND_OMEGA * stalk.velocity -
				WIND_OMEGA * WIND_OMEGA * (stalk.angle - target);
			stalk.velocity += acceleration * dt;
			stalk.angle += stalk.velocity * dt;
			if (
				Math.abs(stalk.angle - target) < 0.01 &&
				Math.abs(stalk.velocity) < 0.01
			) {
				stalk.angle = target;
				stalk.velocity = 0;
			} else {
				moving = true;
			}
		}
		pointerVelocity *= 0.85;
		return moving;
	};

	const tick = (now: number) => {
		// Capped, so a tab that slept does not arrive with one huge step.
		const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
		last = now;
		const windy = blow(dt, now) || pointerX !== null;
		if (windy || now - lastDrawn >= SWAY_FRAME_MS) draw(now);
		const alive = !holdStill() || windy;
		frame = visible && enabled && alive ? requestAnimationFrame(tick) : 0;
		if (!frame) last = 0;
	};
	const wake = () => {
		if (!frame && visible && enabled) frame = requestAnimationFrame(tick);
	};

	const regrow = () => {
		stalks = growField(options, fieldWidth, heightScale);
	};
	const resize = () => {
		const width = canvas.clientWidth;
		dpr = Math.min(window.devicePixelRatio || 1, 2);
		canvas.width = Math.round(width * dpr);
		canvas.height = Math.round(height * dpr);
		// Only a new width changes the field; a new pixel ratio just redraws it.
		if (width !== fieldWidth) {
			fieldWidth = width;
			regrow();
		}
		left = null;
		enabled = options.active?.() ?? true;
		draw(performance.now());
		wake();
	};
	const refresh = () => {
		readColors();
		const scale = options.heightScale?.() ?? 1;
		if (scale !== heightScale) {
			heightScale = scale;
			regrow();
		}
		enabled = options.active?.() ?? true;
		draw(performance.now());
		wake();
	};

	const onPointerMove = (event: PointerEvent) => {
		if (holdStill()) return;
		left ??= canvas.getBoundingClientRect().left;
		const x = event.clientX - left;
		if (previousX !== null) pointerVelocity = x - previousX;
		previousX = x;
		pointerX = x;
		wake();
	};
	const onPointerLeave = () => {
		pointerX = null;
		previousX = null;
		left = null;
		wake();
	};
	if (options.wind) {
		canvas.addEventListener("pointermove", onPointerMove);
		canvas.addEventListener("pointerleave", onPointerLeave);
	}
	const sight = new IntersectionObserver((entries) => {
		const wasVisible = visible;
		for (const entry of entries) visible = entry.isIntersecting;
		if (visible && !wasVisible) {
			nextGust = performance.now() + between(FIRST_GUST_MS);
		}
		wake();
	});
	sight.observe(canvas);
	const size = new ResizeObserver(resize);
	size.observe(canvas);
	// Light/dark, high contrast, the palette and "Less movement" all live as
	// attributes on <html>.
	const settings = new MutationObserver(refresh);
	settings.observe(document.documentElement, { attributes: true });

	heightScale = options.heightScale?.() ?? 1;
	readColors();
	resize();

	return {
		refresh,
		dispose: () => {
			cancelAnimationFrame(frame);
			canvas.removeEventListener("pointermove", onPointerMove);
			canvas.removeEventListener("pointerleave", onPointerLeave);
			sight.disconnect();
			size.disconnect();
			settings.disconnect();
		},
	};
}
