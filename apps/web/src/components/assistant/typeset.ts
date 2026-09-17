import { useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { useDisplayPref } from "#/lib/display-prefs.ts";

/**
 * Separates when text ARRIVES from when it is shown.
 *
 * The cadence of an answer used to be the provider's. `assistant-runs.tsx`
 * appends every `delta` straight to state, and what a delta holds is a decision
 * made in somebody else's datacentre: one model sends a token per frame, the
 * next sends a whole paragraph in one. The screen showed exactly that
 * difference — the same question answered twice, once as a typewriter and once
 * as a block that landed all at once.
 *
 * So the arrived text is the TARGET and the visible text chases it. The speed
 * is proportional to how far behind it is, which is a first-order settle — the
 * text form of the critically damped spring the rest of the app animates with
 * (`lib/motion.ts`). A burst drains fast and eases out; a trickle is never held
 * back, because a small backlog is cleared in one frame. `RESPONSE` is the
 * spring's own parameter and means the same thing here: not a duration, but the
 * time the lag decays on.
 *
 * Two rules keep it honest. It never rewinds — a shorter string is a new turn,
 * not a correction, and it snaps. And it starts at whatever had already
 * arrived, so opening a thread whose turn is still running does not replay the
 * answer from its first word.
 */

/** The time constant while the turn is still running. */
const RESPONSE_LIVE = 0.22;

/** The same, once the stream has ended and the only job left is to finish.
 *
 *  Shorter, because the answer is now complete and the reader is waiting for
 *  nothing else — and because `settle` in `assistant-runs.tsx` is about to
 *  replace this text with the server's stored copy of it. Whatever is still
 *  undrained when that lands appears in one frame. With `MAX_LAG` below the
 *  worst case is a few hundred milliseconds, which the refetch it races
 *  normally costs anyway. */
const RESPONSE_END = 0.08;

/** The furthest behind the display is ever allowed to fall, in characters.
 *
 *  A provider that hands over half an answer in one frame would otherwise be
 *  read out for seconds after the turn had ended. Past this, the surplus is
 *  skipped rather than drained: a ceiling on the lag, not on the rate. */
const MAX_LAG = 320;

/** A frame longer than this is a tab that was in the background, not a slow
 *  one. Clamped, or coming back to the tab dumps the whole answer at once. */
const MAX_FRAME = 0.05;

const isSpace = (character: string) => /\s/.test(character);

/**
 * The end of the last WHOLE word in `text`.
 *
 * The word still arriving is held back on purpose. The reveal in `answer.tsx`
 * blurs a word in as it mounts, and a word that then grows one character at a
 * time inside that span reads as a glitch rather than as a word.
 */
const wholeWordEnd = (text: string) => {
	for (let index = text.length - 1; index >= 0; index -= 1) {
		if (isSpace(text.charAt(index))) return index;
	}
	return 0;
};

/** `from`, moved forward over whole words until at least `chars` characters
 *  have been passed. It never stops inside a word, which is what makes one
 *  character the useful floor: the smallest step this can take is one word. */
const advanceBy = (text: string, from: number, chars: number) => {
	const limit = from + chars;
	let index = from;
	while (index < text.length && index < limit) {
		while (index < text.length && isSpace(text.charAt(index))) index += 1;
		while (index < text.length && !isSpace(text.charAt(index))) index += 1;
	}
	return index;
};

/**
 * The part of `text` that should be on screen this frame.
 *
 * `streaming` is the turn's own state, not this hook's: it decides whether the
 * word still arriving is held back, and which time constant the catch-up uses.
 *
 * There is no drain at all when movement is turned down. The pacing is
 * narration, and both settings ask for the content rather than the telling of
 * it. TWO settings, because they are independent and neither implies the other:
 * the OS preference, and Preferences → Display → "Less movement", which is this
 * device's own switch (`lib/display-prefs.ts`). The CSS rule behind the second
 * one ends the word reveal by itself; it cannot reach a loop that runs in JS,
 * so this hook has to read it.
 */
export function useTypeset(text: string, streaming: boolean): string {
	const [lessMotion] = useDisplayPref("lessMotion");
	const reduced = useReducedMotion() === true || lessMotion;
	// Seeded with what has already arrived, so a thread opened mid-turn picks up
	// where the answer is rather than at its first word.
	const [visible, setVisible] = useState(text.length);
	const shown = useRef(visible);
	const frame = useRef<number | null>(null);
	const clock = useRef(0);

	// The loop is created once per drain and runs across many deltas, so it reads
	// both of these through a ref rather than closing over the render that
	// started it. They are written in the effect below rather than during render,
	// which leaves them one frame stale in the window between a delta and its
	// effect — the loop drains a little less that frame and catches up on the
	// next, which is the same thing it does for every other burst.
	const arrived = useRef(text);
	const live = useRef(streaming);

	useEffect(() => {
		return () => {
			if (frame.current !== null) cancelAnimationFrame(frame.current);
		};
	}, []);

	useEffect(() => {
		arrived.current = text;
		live.current = streaming;
		// Movement is turned down, so there is no drain: the whole of what has
		// arrived is returned below without going through state at all. The
		// position is still kept current, so switching the setting back ON
		// mid-answer carries on from where the reader is instead of replaying
		// what they have already read.
		if (reduced) {
			shown.current = text.length;
			return;
		}
		// A shorter string is the store handing this component a different turn —
		// a second question in the same thread, or the live copy cleared at
		// settle. There is nothing to catch up to, and rewinding would play the
		// old answer backwards.
		if (text.length < shown.current) {
			shown.current = text.length;
			setVisible(text.length);
		}
		// Already draining. The refs above are what carry this delta into the loop
		// that is running; tearing it down and starting another would reset the
		// frame clock on every token.
		if (frame.current !== null) return;
		clock.current = performance.now();
		const step = (now: number) => {
			const seconds = Math.min((now - clock.current) / 1000, MAX_FRAME);
			clock.current = now;
			const source = arrived.current;
			const end = live.current ? wholeWordEnd(source) : source.length;
			let from = shown.current;
			if (end - from > MAX_LAG) {
				from = Math.min(advanceBy(source, from, end - from - MAX_LAG), end);
			}
			const lag = end - from;
			// Caught up. The loop stops rather than idling at 60fps — the effect
			// above starts it again on the next delta, and on the one that ends the
			// turn, which is what releases the word that was being held back.
			if (lag <= 0) {
				frame.current = null;
				return;
			}
			const response = live.current ? RESPONSE_LIVE : RESPONSE_END;
			const next = Math.min(
				advanceBy(source, from, Math.max(1, (lag / response) * seconds)),
				end,
			);
			shown.current = next;
			setVisible(next);
			frame.current = requestAnimationFrame(step);
		};
		frame.current = requestAnimationFrame(step);
	}, [text, streaming, reduced]);

	return reduced ? text : text.slice(0, visible);
}
