/**
 * Whether a request's `Accept-Encoding` header admits a gzip response.
 *
 * Parsed per RFC 9110 section 12.5.3, not by substring: `gzip;q=0` is a client
 * that says it must NOT get gzip, and a bare `.includes("gzip")` read it as a
 * yes. The rules:
 *
 *  - `gzip` (or its old alias `x-gzip`) with a weight above zero admits it.
 *  - A listed `gzip` decides on its own, whatever `*` says.
 *  - Without a `gzip` entry, `*` with a weight above zero admits it.
 *  - A missing or empty header admits nothing. The RFC would allow any coding
 *    there, but the plain bytes are never wrong, so the doubt goes that way.
 *  - A weight that does not parse counts as zero, for the same reason.
 *
 * Lives outside `server.ts` so it can be tested: that file starts a server on
 * import.
 */
export const acceptsGzip = (header: string | null | undefined): boolean => {
	if (!header) return false;
	let gzip: number | null = null;
	let wildcard: number | null = null;
	for (const entry of header.split(",")) {
		const [rawCoding = "", ...params] = entry.split(";");
		const coding = rawCoding.trim().toLowerCase();
		if (!coding) continue;
		const weight = weightOf(params);
		if (coding === "gzip" || coding === "x-gzip") {
			gzip = Math.max(gzip ?? 0, weight);
		} else if (coding === "*") {
			wildcard = Math.max(wildcard ?? 0, weight);
		}
	}
	return (gzip ?? wildcard ?? 0) > 0;
};

/** The `q` parameter of one entry: 1 when absent, 0 when it does not parse or
 *  falls outside 0..1. */
const weightOf = (params: string[]): number => {
	for (const param of params) {
		const [rawName = "", rawValue = ""] = param.split("=");
		if (rawName.trim().toLowerCase() !== "q") continue;
		const value = rawValue.trim();
		// RFC 9110's `qvalue`: 0 or 1, with at most three decimals.
		if (!/^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(value)) return 0;
		return Number(value);
	}
	return 1;
};
