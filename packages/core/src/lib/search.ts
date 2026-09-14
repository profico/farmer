/**
 * Folds text for a list filter: case and accents both drop out, so
 * "vasiljevic" finds "Vasiljević". A Harvest import can leave both spellings
 * of one name in the same workspace, and an accent-exact filter finds half.
 */
export const foldForSearch = (text: string) =>
	text
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.toLowerCase()
		.trim();

/**
 * Whether a row passes the search box above its list.
 *
 * Every word of the query must appear somewhere in the row's fields, in any
 * order — "abc web" finds "ABC Nyheter web" under client "ABC Startsiden".
 * An empty query matches everything, so callers can filter unconditionally.
 */
export function matchesSearch(
	query: string,
	fields: readonly (string | null | undefined)[],
): boolean {
	const terms = foldForSearch(query).split(/\s+/).filter(Boolean);
	if (terms.length === 0) return true;
	const haystack = foldForSearch(fields.filter(Boolean).join(" "));
	return terms.every((term) => haystack.includes(term));
}
