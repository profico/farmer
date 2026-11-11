import { CopyIcon, DownloadSimpleIcon, ImageIcon } from "@phosphor-icons/react";
import { toast } from "sonner";

import type { ChartSpec } from "./answer-chart.tsx";
import {
	chartRows,
	exportFileName,
	tableRows,
	toCsv,
	toTsv,
} from "./answer-export.ts";

const buttonClass =
	"quiet flex items-center gap-1.5 rounded-control px-1.5 py-1 text-[12px] transition-colors duration-(--dur-fast) hover:bg-hover";

// Shown on hover or focus of the block. Always shown where there is no hover.
const barClass =
	"flex items-center gap-1 opacity-0 transition-opacity duration-(--dur-base) group-hover/export:opacity-100 focus-within:opacity-100 max-md:opacity-100";

const saveBlob = (blob: Blob, name: string) => {
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = name;
	link.click();
	// Revoked late: some browsers read the URL after the click returns.
	setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const saveCsv = (rows: string[][], name: string) =>
	saveBlob(
		new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" }),
		`${name}.csv`,
	);

/** The computed color of a CSS variable, as a string a canvas accepts. */
const cssColor = (name: string) => {
	const probe = document.createElement("span");
	probe.style.color = `var(${name})`;
	document.body.append(probe);
	const color = getComputedStyle(probe).color;
	probe.remove();
	return color;
};

type Palette = {
	bg: string;
	ink: string;
	ink2: string;
	track: string;
	bar: string;
};

const readPalette = (): Palette => ({
	bg: cssColor("--bg"),
	ink: cssColor("--ink"),
	ink2: cssColor("--ink-2"),
	track: cssColor("--inset"),
	bar: cssColor("--chart-1"),
});

const printValue = (value: number, unit?: string) =>
	`${Math.round(value * 100) / 100}${unit ?? ""}`;

const SCALE = 2;
const PAD = 16;
const TITLE_H = 28;

type Draw = {
	ctx: CanvasRenderingContext2D;
	spec: ChartSpec;
	palette: Palette;
	width: number;
	top: number;
	peak: number;
};

const drawBars = ({ ctx, spec, palette, width, top, peak }: Draw) => {
	const labelW = 160;
	const valueW = 64;
	const trackW = width - PAD * 2 - labelW - valueW;
	spec.data.forEach((point, index) => {
		const y = top + index * 24;
		ctx.fillStyle = palette.ink2;
		ctx.textAlign = "left";
		ctx.fillText(point.label.slice(0, 24), PAD, y + 12);
		ctx.fillStyle = palette.track;
		ctx.fillRect(PAD + labelW, y + 6, trackW, 10);
		ctx.fillStyle = palette.bar;
		const share = peak === 0 ? 0 : Math.max(0, point.value / peak);
		ctx.fillRect(PAD + labelW, y + 6, Math.max(trackW * share, 1), 10);
		ctx.fillStyle = palette.ink;
		ctx.textAlign = "right";
		ctx.fillText(printValue(point.value, spec.unit), width - PAD, y + 12);
	});
};

const drawColumns = ({ ctx, spec, palette, width, top, peak }: Draw) => {
	const slot = (width - PAD * 2) / spec.data.length;
	const trackH = 120;
	spec.data.forEach((point, index) => {
		const x = PAD + index * slot;
		const mid = x + slot / 2;
		ctx.textAlign = "center";
		ctx.fillStyle = palette.ink2;
		ctx.fillText(printValue(point.value, spec.unit), mid, top + 12);
		ctx.fillStyle = palette.track;
		ctx.fillRect(x + 2, top + 20, slot - 4, trackH);
		ctx.fillStyle = palette.bar;
		const share = peak === 0 ? 0 : Math.max(0, point.value / peak);
		const barH = Math.max(trackH * share, 2);
		ctx.fillRect(x + 2, top + 20 + trackH - barH, slot - 4, barH);
		ctx.fillStyle = palette.ink2;
		ctx.fillText(point.label.slice(0, 8), mid, top + trackH + 38);
	});
};

/** The chart is HTML and CSS, not SVG, so it is drawn again on a canvas
 *  from its spec with the colors of the current theme. */
const renderChart = (spec: ChartSpec) => {
	const trend = spec.type === "trend";
	const width = trend ? Math.max(640, spec.data.length * 44 + PAD * 2) : 640;
	const top = PAD + (spec.title ? TITLE_H : 0);
	const body = trend ? 170 : spec.data.length * 24;
	const height = top + body + PAD;
	const canvas = document.createElement("canvas");
	canvas.width = width * SCALE;
	canvas.height = height * SCALE;
	const ctx = canvas.getContext("2d");
	if (!ctx) return null;
	ctx.scale(SCALE, SCALE);
	const palette = readPalette();
	ctx.fillStyle = palette.bg;
	ctx.fillRect(0, 0, width, height);
	const font = getComputedStyle(document.body).fontFamily;
	if (spec.title) {
		ctx.font = `500 13px ${font}`;
		ctx.fillStyle = palette.ink;
		ctx.textAlign = "left";
		ctx.fillText(spec.title, PAD, PAD + 12);
	}
	ctx.font = `12px ${font}`;
	const peak = Math.max(...spec.data.map((point) => Math.abs(point.value)), 0);
	const draw = { ctx, spec, palette, width, top, peak };
	if (trend) drawColumns(draw);
	else drawBars(draw);
	return canvas;
};

const toPng = (canvas: HTMLCanvasElement) =>
	new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));

const downloadPng = async (spec: ChartSpec, name: string) => {
	const canvas = renderChart(spec);
	const blob = canvas ? await toPng(canvas) : null;
	if (!blob) {
		toast.error("Could not make the image");
		return;
	}
	saveBlob(blob, `${name}.png`);
};

export function TableExport({
	head,
	rows,
	title,
}: {
	head: string[];
	rows: string[][];
	title?: string;
}) {
	const all = tableRows(head, rows);
	const name = exportFileName(title, "farmer-table");
	const copy = async () => {
		try {
			await navigator.clipboard.writeText(toTsv(all));
			toast.success("Table copied");
		} catch {
			toast.error("Could not copy the table");
		}
	};
	return (
		<div className={barClass}>
			<button
				type="button"
				onClick={() => saveCsv(all, name)}
				title="Download CSV"
				aria-label="Download table as CSV"
				className={buttonClass}
			>
				<DownloadSimpleIcon weight="regular" className="size-3.5" />
				CSV
			</button>
			<button
				type="button"
				onClick={() => void copy()}
				title="Copy as table"
				aria-label="Copy as table"
				className={buttonClass}
			>
				<CopyIcon weight="regular" className="size-3.5" />
				Copy
			</button>
		</div>
	);
}

export function ChartExport({ spec }: { spec: ChartSpec }) {
	const name = exportFileName(spec.title, "farmer-chart");
	return (
		<div className={barClass}>
			<button
				type="button"
				onClick={() => void downloadPng(spec, name)}
				title="Download PNG"
				aria-label="Download chart as PNG"
				className={buttonClass}
			>
				<ImageIcon weight="regular" className="size-3.5" />
				PNG
			</button>
			<button
				type="button"
				onClick={() => saveCsv(chartRows(spec), name)}
				title="Download CSV"
				aria-label="Download chart data as CSV"
				className={buttonClass}
			>
				<DownloadSimpleIcon weight="regular" className="size-3.5" />
				CSV
			</button>
		</div>
	);
}
