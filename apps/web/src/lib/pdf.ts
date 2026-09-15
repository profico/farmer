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
	const [{ jsPDF }, { default: autoTable }] = await Promise.all([
		import("jspdf"),
		import("jspdf-autotable"),
	]);

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
		doc.text(report.note, MARGIN, y + 1);
		y += LINE;
	}

	// ── The table ───────────────────────────────────────────────────────────
	// Harvest's rules: a rule under each entry (under its note, when it has
	// one), a tinted row over each group, the total under a heavier rule.
	const last = report.columns.length - 1;
	const align = (i: number): Styles["halign"] =>
		report.columns[i]?.align ?? "left";
	const under: Partial<Styles> = { lineWidth: { bottom: 0.25 } };
	const tinted: Partial<Styles> = { fillColor: GROUP_FILL };

	const body: CellDef[][] = report.groups.flatMap((group) => {
		const rows = group.rows.flatMap((row) => {
			// An entry with a note is ruled off under the note, not under itself.
			const cells = row.cells.map((content, i) => {
				const styles: Partial<Styles> = { halign: align(i) };
				if (!row.note) styles.lineWidth = under.lineWidth;
				return cell(content, styles);
			});
			if (!row.note) return [cells];
			return [
				cells,
				[
					cell("", under),
					cell(row.note, { textColor: MUTED, fontSize: 8.5, ...under }, last),
				],
			];
		});
		if (group.heading === undefined) return rows;
		return [
			[
				cell(group.heading, tinted, last),
				cell(group.hours ?? "", { ...tinted, halign: "right" }),
			],
			...rows,
		];
	});
	const totalRow: Partial<Styles> = {
		halign: "right",
		fontStyle: "bold",
		lineWidth: { top: 0.4 },
	};
	body.push([cell("Total", totalRow, last), cell(report.total, totalRow)]);

	autoTable(doc, {
		startY: y + 4,
		margin: { left: MARGIN, right: MARGIN, top: MARGIN, bottom: MARGIN + 6 },
		theme: "plain",
		head: [report.columns.map((c, i) => cell(c.label, { halign: align(i) }))],
		body,
		styles: {
			font: FONT,
			fontSize: 9,
			textColor: INK,
			lineColor: RULE,
			lineWidth: 0,
			cellPadding: { top: 2.4, bottom: 2.4, left: 2, right: 2 },
			overflow: "linebreak",
		},
		headStyles: {
			fillColor: HEAD_FILL,
			textColor: MUTED,
			fontStyle: "normal",
		},
		columnStyles: { [last]: { cellWidth: 22 } },
	});

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
