/**
 * Plain-text tables. Every list the CLI prints is one, with a total row,
 * because "how much is that" is the next question after "what did I log".
 */

export type Align = "left" | "right";

export type Column = {
	header: string;
	align?: Align;
	/** The column that gives up width when the terminal is too narrow — the
	 *  description, never a duration or an id. */
	shrink?: boolean;
};

export type Table = {
	columns: Column[];
	rows: string[][];
	/** Printed under a rule. Null for a table with nothing to add up. */
	total: string[] | null;
};

const GAP = "  ";

/** A shrinking column keeps at least this much, or it stops saying anything. */
const MIN_SHRINK_WIDTH = 12;

const width = (text: string) => Bun.stringWidth(text);

const truncate = (text: string, max: number): string => {
	if (width(text) <= max) return text;
	let out = "";

	for (const char of text) {
		if (width(`${out}${char}…`) > max) break;
		out += char;
	}

	return `${out}…`;
};

const pad = (text: string, size: number, align: Align) => {
	const fill = " ".repeat(Math.max(0, size - width(text)));

	return align === "right" ? `${fill}${text}` : `${text}${fill}`;
};

/**
 * Lays the table out as lines. `maxWidth` is the terminal width, or null for a
 * pipe — a script reading the output wants the whole description, and has no
 * screen for it to wrap on.
 */
export const formatTable = (
	table: Table,
	maxWidth: number | null,
): string[] => {
	const all = [
		table.columns.map((column) => column.header),
		...table.rows,
		...(table.total ? [table.total] : []),
	];

	const sizes = table.columns.map((_, index) =>
		Math.max(...all.map((row) => width(row[index] ?? ""))),
	);

	if (maxWidth !== null) {
		const used =
			sizes.reduce((sum, size) => sum + size, 0) +
			GAP.length * (sizes.length - 1);

		const overflow = used - maxWidth;
		const shrinkIndex = table.columns.findIndex((column) => column.shrink);
		const current = sizes[shrinkIndex];

		if (overflow > 0 && current !== undefined) {
			sizes[shrinkIndex] = Math.max(MIN_SHRINK_WIDTH, current - overflow);
		}
	}

	const line = (row: string[]) =>
		table.columns
			.map((column, index) => {
				const size = sizes[index] ?? 0;

				return pad(
					truncate(row[index] ?? "", size),
					size,
					column.align ?? "left",
				);
			})
			.join(GAP)
			.trimEnd();

	const lines = [line(all[0] ?? []), ...table.rows.map(line)];

	if (table.total) {
		const ruleWidth =
			sizes.reduce((sum, size) => sum + size, 0) +
			GAP.length * (sizes.length - 1);

		lines.push("-".repeat(ruleWidth), line(table.total));
	}

	return lines;
};
