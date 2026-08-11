import { PageLoadingSkeleton } from "#/components/states/loading-skeleton.tsx";

/**
 * App-wide fallback for `defaultPendingComponent`. Shown while a route's
 * loader/query is in flight past the pending-minMs threshold (`router.tsx`).
 *
 * Anchored top-left, where the incoming page's eyebrow and title will be — a
 * centred loader puts the one moving thing on screen where nothing is about to
 * appear, so the eye has to travel back up the moment the page lands.
 *
 * This used to be a lone 16px spinner sitting at that spot, which took the
 * argument only half way: it was in the right *place*, but a single glyph in a
 * full-height island reads as an unfinished screen rather than as the page
 * arriving, and there was nothing about its shape to suggest what was coming.
 * A skeleton is the same idea carried through — it stands where the content
 * will stand and is already the size of it, so the page resolves into place
 * instead of replacing something unrelated.
 */
export function RoutePending() {
	return (
		<div className="island island-pad flex-1">
			<PageLoadingSkeleton />
		</div>
	);
}
