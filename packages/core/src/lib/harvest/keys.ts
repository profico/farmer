// The row key and the person-day key from plan section 5.3. Both are pure
// functions of the row's own fields — no database, no import run — so they
// can run in the browser worker that also parses the file and produce the
// same key a second run of the same file would produce.
//
// Uses Web Crypto (`crypto.subtle.digest`), which exists in both a browser
// Worker and Bun, rather than a node `crypto` import.

/** Groups rows by the person and the day they were logged on. */
export function personDayKey(
	date: string,
	firstName: string,
	lastName: string,
): string {
	return JSON.stringify([date, firstName, lastName]);
}

export interface ImportKeyFields {
	date: string;
	firstName: string;
	lastName: string;
	client: string;
	project: string;
	projectCode: string;
	task: string;
	notes: string;
	hours: string;
}

// JSON.stringify on the fixed-order tuple keeps the fields unambiguous when
// joined: unlike a delimited string, a comma or colon inside `notes` cannot
// be mistaken for a field boundary.
function canonicalize(fields: ImportKeyFields): string {
	return JSON.stringify([
		fields.date,
		fields.firstName,
		fields.lastName,
		fields.client,
		fields.project,
		fields.projectCode,
		fields.task,
		fields.notes,
		fields.hours,
	]);
}

async function sha256Hex(input: string): Promise<string> {
	const bytes = new TextEncoder().encode(input);
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	const view = new Uint8Array(digest);
	let hex = "";

	for (let i = 0; i < view.length; i++) {
		hex += view[i]?.toString(16).padStart(2, "0");
	}

	return hex;
}

/** The hash half of the import key, with no `n` counter applied yet. Two
 * rows with identical fields hash the same — `keysForPersonDay` is what
 * tells them apart. */
export function hashImportKeyFields(fields: ImportKeyFields): Promise<string> {
	return sha256Hex(canonicalize(fields));
}

/** A single row's import key: `sha256(fields) + ":" + n`. Prefer
 * `keysForPersonDay` when hashing every row of a person-day, since it
 * assigns `n` for you and hashes in one batch. */
export async function importRowKey(
	fields: ImportKeyFields,
	n: number,
): Promise<string> {
	const hash = await hashImportKeyFields(fields);

	return `${hash}:${n}`;
}

/**
 * Takes every row of one person-day, in file order, and returns their import
 * keys in the same order. `n` is the 0-based position among rows whose
 * fields hash identically — two Harvest rows with the same date, person,
 * client, project, code, task, notes and hours get `:0` and `:1`.
 *
 * Hashing runs as one batched `Promise.all`, not an `await` per row in a
 * loop, so calling this once per person-day (rather than once per row)
 * keeps 240k rows well under a second — see the scratch benchmark in the
 * import plan.
 */
export async function keysForPersonDay(
	rows: readonly ImportKeyFields[],
): Promise<string[]> {
	const hashes = await Promise.all(rows.map(hashImportKeyFields));
	const counts = new Map<string, number>();

	return hashes.map((hash) => {
		const n = counts.get(hash) ?? 0;
		counts.set(hash, n + 1);

		return `${hash}:${n}`;
	});
}

/** The length of the day digest, in hex characters. 64 bits is ample to tell
 * one person-day's key set from another, and it keeps the snapshot of a
 * 240k-row history small enough to send to the browser. */
export const DAY_DIGEST_LENGTH = 16;

/** One person-day's imported key set as a short digest. The server computes
 * the same value in SQL (`harvest-import.service.ts`, `snapshot`): the keys
 * sorted by code unit, joined with ",", then SHA-256. Keys are ASCII (hex, a
 * colon and a counter), so a JS sort and Postgres's `collate "C"` agree. */
export async function dayDigest(keys: readonly string[]): Promise<string> {
	const joined = [...keys].sort().join(",");

	return (await sha256Hex(joined)).slice(0, DAY_DIGEST_LENGTH);
}
