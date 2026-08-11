/**
 * Shown wherever a screen has nothing to draw.
 *
 * No icon, deliberately. The app puts glyphs in the nav and in buttons; a 26px
 * symbol floating over an empty list is the one place a screen ends up
 * decorated rather than explained — and it only ever appears on whichever
 * screen happens to be empty, so it reads as a stray. The sentence does the
 * work instead, and says *why* it's empty rather than just that it is.
 */
export function EmptyState({
	title,
	description,
	action,
}: {
	title: string;
	description?: string;
	action?: React.ReactNode;
}) {
	return (
		<div className="px-4 py-8 sm:px-8">
			<p className="h2">{title}</p>
			{description && <p className="lede mt-2 max-w-[52ch]">{description}</p>}
			{action && <div className="mt-5">{action}</div>}
		</div>
	);
}
