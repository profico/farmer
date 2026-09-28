/**
 * A timestamp in the reader's own timezone and locale conventions.
 *
 * The server renders a page first, in the server's timezone, and the browser
 * then renders it in the reader's — so the two texts can differ, and the
 * browser's is the right one. `suppressHydrationWarning` says that mismatch is
 * expected, for this one element only.
 */
export function When({ date }: { date: Date }) {
	const value = new Date(date);
	return (
		<time dateTime={value.toISOString()} suppressHydrationWarning>
			{value.toLocaleString("en-US", {
				dateStyle: "medium",
				timeStyle: "short",
			})}
		</time>
	);
}
