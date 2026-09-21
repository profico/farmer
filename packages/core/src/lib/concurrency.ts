// Bounded parallelism for a list of independent async calls.
//
// Every caller here is fanning out to somebody else's API — GitHub's repo
// scans, Google Calendar's per-event lookups — where serial is too slow and
// unbounded is a rate limit. It lives in lib rather than in one service
// because two services now want the same three lines.

/**
 * Run `fn` over `items` with at most `limit` calls in flight, and return the
 * results in the order of `items`. A rejection rejects the whole map, as
 * `Promise.all` does.
 */
export const mapBounded = async <T, R>(
	items: T[],
	limit: number,
	fn: (item: T) => Promise<R>,
): Promise<R[]> => {
	const results = new Array<R>(items.length);
	let next = 0;
	const workers = Array.from(
		{ length: Math.min(Math.max(limit, 1), items.length) },
		async () => {
			for (let i = next++; i < items.length; i = next++) {
				// SAFETY: `i < items.length` is the loop condition and `items` is a dense array
				// the caller passed in, so the element is present. `noUncheckedIndexedAccess`
				// cannot see that through the shared cursor.
				results[i] = await fn(items[i] as T);
			}
		},
	);
	await Promise.all(workers);
	return results;
};
