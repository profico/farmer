/** Lower case, without accents, so "cafe" finds "Café". */
const fold = (text: string) =>
	text
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase();

/** True when every word of `query` is in one of the `fields`. An empty
 *  query matches all. */
export const matchesSearch = (
	query: string,
	fields: readonly (string | null | undefined)[],
) => {
	const words = fold(query).split(/\s+/).filter(Boolean);
	if (words.length === 0) return true;
	const haystack = fold(fields.filter(Boolean).join(" "));
	return words.every((word) => haystack.includes(word));
};
