// An RFC 4180 CSV parser. No node/bun APIs — this file runs in a browser Web
// Worker as well as in `bun test`. It works on a `string` already in memory
// (the caller decoded the file, stripping nothing) and never concatenates
// characters one at a time: every field is built from `String.slice` ranges,
// joined only when a field contains an escaped quote.
//
// Handles: quoted fields, `""` escapes, a line break (CR, LF or CRLF) inside
// a quoted field, both CRLF and LF row endings, a leading UTF-8 BOM, a
// trailing newline (no spurious empty row), and empty fields.

const COMMA = 44;
const CR = 13;
const LF = 10;
const QUOTE = 34;
const BOM = 0xfeff;

interface FieldResult {
	value: string;
	next: number;
}

// Reads one field starting at `start`. Returns the field's text and the
// index right after it (at the delimiter, the row ending, or `len`).
function readField(text: string, start: number, len: number): FieldResult {
	if (start < len && text.charCodeAt(start) === QUOTE) {
		let i = start + 1;
		let segmentStart = i;
		let parts: string[] | null = null;
		for (;;) {
			if (i >= len) {
				// Unterminated quote at end of file: take the rest as content.
				const tail = text.slice(segmentStart, i);
				return { value: parts ? parts.join("") + tail : tail, next: i };
			}
			const code = text.charCodeAt(i);
			if (code === QUOTE) {
				if (i + 1 < len && text.charCodeAt(i + 1) === QUOTE) {
					// `""` inside a quoted field is one literal quote character.
					(parts ??= []).push(text.slice(segmentStart, i), '"');
					i += 2;
					segmentStart = i;
					continue;
				}
				const tail = text.slice(segmentStart, i);
				return { value: parts ? parts.join("") + tail : tail, next: i + 1 };
			}
			i += 1;
		}
	}
	let i = start;
	while (i < len) {
		const code = text.charCodeAt(i);
		if (code === COMMA || code === CR || code === LF) break;
		i += 1;
	}
	return { value: text.slice(start, i), next: i };
}

/**
 * Lazily yields one row (array of field strings) at a time, without holding
 * the whole parsed result in memory. Reading only the header costs only the
 * work to scan the first line — the rest of a 100 MB file is never touched.
 */
export function* iterateCsv(text: string): Generator<string[]> {
	const len = text.length;
	let pos = len > 0 && text.charCodeAt(0) === BOM ? 1 : 0;
	if (pos >= len) return;

	while (true) {
		const row: string[] = [];
		for (;;) {
			const field = readField(text, pos, len);
			row.push(field.value);
			pos = field.next;
			if (pos >= len) {
				yield row;
				return;
			}
			const code = text.charCodeAt(pos);
			if (code === COMMA) {
				pos += 1;
				continue;
			}
			if (code === CR) {
				pos += 1;
				if (pos < len && text.charCodeAt(pos) === LF) pos += 1;
				break;
			}
			if (code === LF) {
				pos += 1;
				break;
			}
			// A field always ends at a comma, CR, LF or end of text — readField
			// never stops anywhere else, so this is unreachable.
			break;
		}
		yield row;
		if (pos >= len) return;
	}
}

/** Parses the whole text into an array of rows. For a 100 MB file, prefer
 * `iterateCsv` so a caller can process rows without holding two copies
 * (the string and the parsed array) at once. */
export function parseCsv(text: string): string[][] {
	return Array.from(iterateCsv(text));
}

/**
 * Reads the header row, then lazily yields each data row as a map from
 * header cell to field value (by position — a short row gets `""` for the
 * missing trailing columns, a long row's extra columns are dropped).
 */
export function* iterateCsvRecords(
	text: string,
): Generator<ReadonlyMap<string, string>> {
	const rows = iterateCsv(text);
	const first = rows.next();
	if (first.done) return;
	const header = first.value;
	for (const row of rows) {
		const record = new Map<string, string>();
		for (let i = 0; i < header.length; i++) {
			record.set(header[i] ?? "", row[i] ?? "");
		}
		yield record;
	}
}

/** Reads just the header row, without scanning the rest of the text. */
export function readCsvHeader(text: string): string[] {
	const rows = iterateCsv(text);
	const first = rows.next();
	return first.done ? [] : first.value;
}
