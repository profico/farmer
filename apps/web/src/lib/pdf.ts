import type { jsPDF } from "jspdf";
import type { CellDef, Styles } from "jspdf-autotable";

/**
 * PDF export — the CSV's sibling, for reading rather than for a spreadsheet:
 * a report laid out the way Harvest's "Detailed time report" is, which is the
 * document the accounting side already gets from there. Built in the browser
 * from the rows on screen, for the CSV's reason (see csv.ts).
 *
 * jsPDF and the font load on the first click, not with the page — together
 * they are half a megabyte the reports page does not need until somebody
 * exports. The font is the app's own, Instrument Sans, as TTF files under
 * public/fonts: a PDF's built-in fonts stop at Latin-1, and "Ferenčak" is
 * exactly the audience.
 */

export type PdfColumn = { label: string; align?: "right" };

export type PdfRow = {
	cells: string[];
	/** A line under the row, indented past the first column — the entry's
	 *  description, the way Harvest sets it. */
	note?: string;
};

export type PdfGroup = {
	/** A summary row over the group with its hours — a date, a project. A group
	 *  without one is the flat table. */
	heading?: string;
	hours?: string;
	rows: PdfRow[];
};

export type PdfReport = {
	title: string;
	org: string;
	from: string;
	to: string;
	/** Formatted hours, written beside "Total" in the header and in the last
	 *  row of the table. */
	total: string;
	/** Label/value pairs at the right of the header: the filters in force. */
	facts: [string, string][];
	/** A caveat under the header, for a table the service capped. */
	note?: string;
	columns: PdfColumn[];
	groups: PdfGroup[];
};

/** 2026-08-01 -> 01/08/2026, the way Harvest and the accounting book write
 *  a day. */
export const formatPdfDate = (key: string): string => {
	const [y, m, d] = key.split("-");

	return `${d}/${m}/${y}`;
};

const FONT = "InstrumentSans";

const FONT_FILES = {
	normal: "InstrumentSans-Regular.ttf",
	bold: "InstrumentSans-SemiBold.ttf",
} as const;

const toBase64 = (buffer: ArrayBuffer): string => {
	const bytes = new Uint8Array(buffer);
	let binary = "";

	for (let i = 0; i < bytes.length; i += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	}

	return btoa(binary);
};

const fetchFont = async (file: string): Promise<string> => {
	const response = await fetch(`/fonts/${file}`);

	if (!response.ok) throw new Error(`${file}: ${response.status}`);

	return toBase64(await response.arrayBuffer());
};

// Fetched once per page load and kept as base64, which is what jsPDF's
// virtual file system takes. A failed fetch is forgotten, so the next click
// tries again rather than failing forever.
let fonts: Promise<[string, string]> | null = null;

const loadFonts = () =>
	(fonts ??= Promise.all([
		fetchFont(FONT_FILES.normal),
		fetchFont(FONT_FILES.bold),
	]).catch((error: unknown) => {
		fonts = null;
		throw error;
	}));

// A4 portrait, millimetres.
const PAGE_W = 210;

const PAGE_H = 297;

const MARGIN = 14;

const CONTENT_W = PAGE_W - 2 * MARGIN;

const LINE = 5.5;

type Rgb = [number, number, number];

const INK: Rgb = [28, 28, 28];

const MUTED: Rgb = [110, 110, 110];

const RULE: Rgb = [205, 205, 205];

const HEAD_FILL: Rgb = [236, 236, 236];

const GROUP_FILL: Rgb = [246, 246, 246];

const cell = (
	content: string,
	styles: Partial<Styles> = {},
	colSpan?: number,
): CellDef => ({ content, styles, colSpan });

/** A run of body row indices that autoTable must never split across a page
 *  break: a group heading with its first entry (and that entry's note, if
 *  it has one), or any other entry with its note. Everything else is its
 *  own one-row chain, which is just the ordinary per-row page-break rule. */
type Chain = number[];

type TableRows = { body: CellDef[][]; chains: Chain[] };

/** Lays the groups out as autoTable rows — Harvest's rules: a rule under
 *  each entry (under its note, when it has one), a tinted row over each
 *  group — and returns the chains alongside, so the caller can keep each
 *  one on a single page. */
const buildTableBody = (
	report: PdfReport,
	align: (i: number) => Styles["halign"],
): TableRows => {
	const last = report.columns.length - 1;
	const under: Partial<Styles> = { lineWidth: { bottom: 0.25 } };
	const tinted: Partial<Styles> = { fillColor: GROUP_FILL };
	const body: CellDef[][] = [];
	const chains: Chain[] = [];

	for (const group of report.groups) {
		// Holds the heading's row index until its first entry's chain is known,
		// so the two (and that entry's note) can be merged into one chain.
		let heading: number | null = null;

		if (group.heading !== undefined) {
			heading = body.length;
			body.push([
				cell(group.heading, tinted, last),
				cell(group.hours ?? "", { ...tinted, halign: "right" }),
			]);
		}

		for (const row of group.rows) {
			const entryIndex = body.length;
			// An entry with a note is ruled off under the note, not under itself.
			body.push(
				row.cells.map((content, i) => {
					const styles: Partial<Styles> = { halign: align(i) };

					if (!row.note) styles.lineWidth = under.lineWidth;

					return cell(content, styles);
				}),
			);
			const chain: Chain = [entryIndex];

			if (row.note) {
				chain.push(body.length);

				const noteStyles: Partial<Styles> = {
					textColor: MUTED,
					fontSize: 8.5,
					halign: "left",
					...under,
				};

				// Indented past the first column, the way Harvest sets it — unless
				// that column is the only one before Hours, where the note takes
				// the whole row rather than the narrow Hours cell.
				body.push(
					last > 1
						? [cell("", under), cell(row.note, noteStyles, last)]
						: [cell(row.note, noteStyles, last + 1)],
				);
			}

			if (heading !== null) {
				chains.push([heading, ...chain]);
				heading = null;
			} else {
				chains.push(chain);
			}
		}

		// A heading with no rows under it — shouldn't happen, but leaves nothing
		// orphaned if it does.
		if (heading !== null) chains.push([heading]);
	}

	return { body, chains };
};

/** One autoTable call's worth of rows. `freshPage` is false only for the
 *  very first chunk, which continues on the current page below the report's
 *  own header rather than starting a new one. */
type PageChunk = { rows: number[]; freshPage: boolean };

/** Splits the body into the pages autoTable would draw it over, except a
 *  chain (see above) that would otherwise straddle a page break is pushed
 *  onto a fresh one whole. Each chunk becomes its own autoTable call, so the
 *  break lands between two chunks rather than inside one. `rowHeights` and
 *  `headHeight` come from a throwaway measurement table — autoTable's own
 *  layout math, without drawing anything — so this lines up with what
 *  autoTable would actually do. A chain taller than a whole page is left to
 *  autoTable's own per-row page breaks; forcing it onto a fresh page would
 *  still not make it fit. */
const paginate = (
	rowHeights: number[],
	chains: Chain[],
	headHeight: number,
	firstPageY: number,
): PageChunk[] => {
	const bottomMargin = MARGIN + 6;
	const continuationCapacity = PAGE_H - bottomMargin - (MARGIN + headHeight);
	let remaining = PAGE_H - bottomMargin - (firstPageY + headHeight);

	const chunks: PageChunk[] = [{ rows: [], freshPage: false }];

	for (const chain of chains) {
		const height = chain.reduce((sum, i) => sum + (rowHeights[i] ?? 0), 0);

		if (height > remaining && height <= continuationCapacity) {
			chunks.push({ rows: [], freshPage: true });
			remaining = continuationCapacity;
		}

		remaining = Math.max(0, remaining - height);
		chunks[chunks.length - 1]?.rows.push(...chain);
	}

	return chunks.filter((chunk) => chunk.rows.length > 0);
};

export async function downloadPdf(
	filename: string,
	report: PdfReport,
): Promise<void> {
	const [normal, bold] = await loadFonts();
	const doc = await buildPdf(report, { normal, bold });
	doc.save(filename);
}

/** The two faces as base64 TTFs. */
export type PdfFonts = { normal: string; bold: string };

/** The document itself, apart from where the fonts come from and where the
 *  bytes go — so it can be rendered outside a browser to be looked at. */
export async function buildPdf(
	report: PdfReport,
	fonts: PdfFonts,
): Promise<jsPDF> {
	const [{ jsPDF }, { default: autoTable, __createTable: createTable }] =
		await Promise.all([import("jspdf"), import("jspdf-autotable")]);

	const doc = new jsPDF({ unit: "mm", format: "a4" });
	doc.addFileToVFS(FONT_FILES.normal, fonts.normal);
	doc.addFont(FONT_FILES.normal, FONT, "normal");
	doc.addFileToVFS(FONT_FILES.bold, fonts.bold);
	doc.addFont(FONT_FILES.bold, FONT, "bold");
	doc.setFont(FONT);

	// ── Header: the title at the left, the organization at the right ────────
	let y = MARGIN + 8;
	doc.setFontSize(20);
	doc.setFont(FONT, "bold");
	doc.setTextColor(...INK);
	doc.text(report.title, MARGIN, y);

	doc.setFontSize(14);
	doc.setFont(FONT, "normal");
	const orgLines: string[] = doc.splitTextToSize(report.org, CONTENT_W / 2);
	doc.text(orgLines, PAGE_W - MARGIN, y, { align: "right" });
	y += (orgLines.length - 1) * 6 + 6;

	doc.setDrawColor(...RULE);
	doc.setLineWidth(0.3);
	doc.line(MARGIN, y, PAGE_W - MARGIN, y);
	y += 10;

	// ── The period and the total at the left, the filters at the right ──────
	// Each block returns the height it took; a value too long for its column
	// wraps rather than running off the page.
	const block = (
		pairs: [string, string][],
		x: number,
		labelWidth: number,
		width: number,
	): number => {
		doc.setFontSize(10);
		let dy = 0;

		for (const [label, value] of pairs) {
			const lines: string[] = doc.splitTextToSize(value, width - labelWidth);
			doc.setFont(FONT, "normal");
			doc.setTextColor(...MUTED);
			doc.text(label, x, y + dy);
			doc.setFont(FONT, "bold");
			doc.setTextColor(...INK);
			lines.forEach((line, i) =>
				doc.text(line, x + labelWidth, y + dy + i * LINE),
			);
			dy += lines.length * LINE;
		}

		return dy;
	};

	const half = CONTENT_W / 2;

	const leftHeight = block(
		[
			[
				"Timeframe",
				`${formatPdfDate(report.from)} – ${formatPdfDate(report.to)}`,
			],
			["Total", `${report.total} hours`],
		],
		MARGIN,
		24,
		half,
	);

	const rightHeight = block(report.facts, MARGIN + half, 26, half);
	y += Math.max(leftHeight, rightHeight);

	if (report.note) {
		doc.setFontSize(9);
		doc.setFont(FONT, "normal");
		doc.setTextColor(...MUTED);
		const noteLines: string[] = doc.splitTextToSize(report.note, CONTENT_W);
		doc.text(noteLines, MARGIN, y + 1);
		y += noteLines.length * LINE;
	}

	// ── The table ───────────────────────────────────────────────────────────
	const last = report.columns.length - 1;

	const align = (i: number): Styles["halign"] =>
		report.columns[i]?.align ?? "left";

	const { body, chains } = buildTableBody(report, align);

	const totalRow: Partial<Styles> = {
		halign: "right",
		fontStyle: "bold",
		lineWidth: { top: 0.4 },
	};

	chains.push([body.length]);
	body.push([cell("Total", totalRow, last), cell(report.total, totalRow)]);

	const tableOptions = {
		theme: "plain" as const,
		head: [report.columns.map((c, i) => cell(c.label, { halign: align(i) }))],
		styles: {
			font: FONT,
			fontSize: 9,
			textColor: INK,
			lineColor: RULE,
			lineWidth: 0,
			cellPadding: { top: 2.4, bottom: 2.4, left: 2, right: 2 },
			overflow: "linebreak" as const,
		},
		headStyles: {
			fillColor: HEAD_FILL,
			textColor: MUTED,
			fontStyle: "normal" as const,
		},
		margin: { left: MARGIN, right: MARGIN, top: MARGIN, bottom: MARGIN + 6 },
		// A row is never split mid-content; `paginate` below decides, chain by
		// chain, whether a whole row (or several kept-together rows) move to
		// the next page, so this needs to hold for the simulation to line up
		// with what autoTable actually draws.
		rowPageBreak: "avoid" as const,
	};

	// A throwaway table, never drawn, purely for autoTable's own row-height and
	// column-width math — `paginate` needs real heights, not a guess, and every
	// chunk below reuses the same widths so the columns don't drift page to
	// page (each chunk's `body` is a different subset of rows, which could
	// otherwise auto-size differently).
	const measured = createTable(doc, {
		...tableOptions,
		body,
		columnStyles: { [last]: { cellWidth: 22 } },
	});

	const headHeight = measured.getHeadHeight(measured.columns);
	const rowHeights = measured.body.map((row) => row.height);
	const columnStyles: Record<number, Partial<Styles>> = {};
	measured.columns.forEach((column, i) => {
		columnStyles[i] = { cellWidth: column.width };
	});

	for (const chunk of paginate(rowHeights, chains, headHeight, y + 4)) {
		if (chunk.freshPage) doc.addPage();
		autoTable(doc, {
			...tableOptions,
			startY: chunk.freshPage ? MARGIN : y + 4,
			columnStyles,
			// Every index in `chunk.rows` came from `chains`, built from this same
			// `body` array by pushing an index right after pushing the row at it,
			// so the lookup below always finds one — the empty case is here only
			// to satisfy `noUncheckedIndexedAccess`.
			body: chunk.rows.flatMap((i) => {
				const row = body[i];

				return row ? [row] : [];
			}),
		});
	}

	// ── Page numbers, once every page exists ────────────────────────────────
	// Written after the table rather than through jsPDF's total-pages
	// placeholder, which cannot be substituted into text set in an embedded
	// font.
	const pages = doc.getNumberOfPages();
	doc.setFontSize(9);
	doc.setFont(FONT, "normal");
	doc.setTextColor(...MUTED);

	for (let page = 1; page <= pages; page++) {
		doc.setPage(page);
		doc.text(`Page ${page} of ${pages}`, PAGE_W / 2, PAGE_H - 8, {
			align: "center",
		});
	}

	return doc;
}
