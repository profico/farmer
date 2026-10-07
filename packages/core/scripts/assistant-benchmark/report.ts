// Turn the stored runs into a ranked summary.
//
//   bun scripts/assistant-benchmark/report.ts <results-dir> [--title "..."]
//
// It reads `runs.jsonl` and writes `summary.json` and `summary.md` in the same
// directory. It makes no model call, so the summary can be built again at any
// time without a cost.

import { parseArgs } from "node:util";

import { QUESTIONS } from "./questions";
import { type RunRecord, runRecordSchema } from "./types";

export type ModelSummary = {
	model: string;
	runs: number;
	passRate: number;
	/** Questions where every repeat passed, as a share of the questions. */
	passAll: number;
	questions: number;
	p50WallS: number;
	p95WallS: number;
	p95FirstProgressS: number | null;
	stalls: number;
	retries: number;
	errors: number;
	ceilingRuns: number;
	costPerRun: number;
	totalCost: number;
	estimatedCost: boolean;
	servedModels: string[];
	providers: string[];
	/** Passes for each question id. */
	byQuestion: Record<string, string>;
	failures: string[];
};

/** The nearest-rank percentile of a list. Null for an empty list. */
export const percentile = (values: number[], share: number): number | null => {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const rank = Math.max(1, Math.ceil(share * sorted.length));
	return sorted[rank - 1] ?? null;
};

const seconds = (ms: number | null) => (ms === null ? null : ms / 1000);

export const summarize = (runs: RunRecord[]): ModelSummary[] => {
	const models = [...new Set(runs.map((run) => run.model))];
	return models.map((model) => {
		const mine = runs.filter((run) => run.model === model);
		const questionIds = [...new Set(mine.map((run) => run.question))];
		const repeatsPerQuestion = Math.max(
			...questionIds.map(
				(id) => mine.filter((run) => run.question === id).length,
			),
		);
		const allPassed = questionIds.filter((id) => {
			const own = mine.filter((run) => run.question === id);
			return own.length === repeatsPerQuestion && own.every((run) => run.pass);
		});
		const wall = mine.map((run) => run.wallMs);
		const totalCost = mine.reduce((sum, run) => sum + run.costUsd, 0);
		const byQuestion: Record<string, string> = {};
		for (const id of questionIds) {
			const own = mine.filter((run) => run.question === id);
			byQuestion[id] = `${own.filter((run) => run.pass).length}/${own.length}`;
		}
		return {
			model,
			runs: mine.length,
			passRate: mine.filter((run) => run.pass).length / mine.length,
			passAll: allPassed.length / questionIds.length,
			questions: questionIds.length,
			p50WallS: seconds(percentile(wall, 0.5)) ?? 0,
			p95WallS: seconds(percentile(wall, 0.95)) ?? 0,
			p95FirstProgressS: seconds(
				percentile(
					mine.flatMap((run) => run.firstProgressMs),
					0.95,
				),
			),
			stalls: mine.reduce((sum, run) => sum + run.stalls, 0),
			retries: mine.reduce((sum, run) => sum + run.retries, 0),
			errors: mine.filter((run) => run.errors.length > 0).length,
			ceilingRuns: mine.filter((run) => run.ceiling).length,
			costPerRun: totalCost / mine.length,
			totalCost,
			estimatedCost: mine.some((run) => run.costEstimated),
			servedModels: [...new Set(mine.flatMap((run) => run.servedModels))],
			providers: [...new Set(mine.flatMap((run) => run.providers))],
			byQuestion,
			failures: mine
				.filter((run) => !run.pass)
				.map((run) => `${run.question} #${run.repeat}: ${run.reason}`),
		};
	});
};

/** The rank key. It is compared in this order: more passing runs, more
 *  questions with all repeats passing, a lower median wall time (whole
 *  seconds), then a lower cost for each run (to 0.0001 USD). */
const rankKey = (summary: ModelSummary): number[] => [
	-Math.round(summary.passRate * summary.runs),
	-Math.round(summary.passAll * summary.questions),
	Math.round(summary.p50WallS),
	Math.round(summary.costPerRun * 10_000),
];

export const rank = (summaries: ModelSummary[]): ModelSummary[] =>
	[...summaries].sort((a, b) => {
		const left = rankKey(a);
		const right = rankKey(b);
		for (let i = 0; i < left.length; i += 1) {
			const difference = (left[i] ?? 0) - (right[i] ?? 0);
			if (difference !== 0) return difference;
		}
		return 0;
	});

const percent = (share: number) => `${(share * 100).toFixed(0)}%`;
const usd = (value: number, digits = 4) => `$${value.toFixed(digits)}`;

export const markdown = (
	title: string,
	ranked: ModelSummary[],
	runs: RunRecord[],
): string => {
	const ids = QUESTIONS.map((question) => question.id);
	// The most repeats that one model ran for one question.
	const counts = new Map<string, number>();
	for (const run of runs) {
		const key = `${run.model} ${run.question}`;
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	const repeats = Math.max(1, ...counts.values());
	const lines: string[] = [`# ${title}`, ""];
	const total = runs.reduce((sum, run) => sum + run.costUsd, 0);
	lines.push(
		`Runs: ${runs.length}. Total cost: ${usd(total, 2)}.`,
		"",
		`| Rank | Model | Pass | Pass^${repeats} | p50 s | p95 s | p95 first s | Stalls | Errors | Cost per run | Total cost |`,
		"|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
	);
	ranked.forEach((summary, index) => {
		lines.push(
			`| ${index + 1} | ${summary.model} | ${percent(summary.passRate)} | ${percent(summary.passAll)} | ${summary.p50WallS.toFixed(1)} | ${summary.p95WallS.toFixed(1)} | ${summary.p95FirstProgressS === null ? "-" : summary.p95FirstProgressS.toFixed(1)} | ${summary.stalls} | ${summary.errors} | ${usd(summary.costPerRun)}${summary.estimatedCost ? " (est.)" : ""} | ${usd(summary.totalCost)} |`,
		);
	});
	lines.push(
		"",
		"## Passing runs for each question",
		"",
		`| Model | ${ids.join(" | ")} |`,
		`|---|${ids.map(() => "---:").join("|")}|`,
	);
	for (const summary of ranked) {
		lines.push(
			`| ${summary.model} | ${ids.map((id) => summary.byQuestion[id] ?? "-").join(" | ")} |`,
		);
	}
	lines.push("", "## Served model and provider", "");
	for (const summary of ranked) {
		lines.push(
			`- ${summary.model}: ${summary.servedModels.join(", ") || "-"} (${summary.providers.join(", ") || "-"})`,
		);
	}
	const failed = runs.filter((run) => !run.pass);
	lines.push("", "## Failures by question", "");
	for (const id of ids) {
		const own = failed.filter((run) => run.question === id);
		if (own.length === 0) continue;
		const reasons = new Map<string, number>();
		for (const run of own) {
			reasons.set(run.reason, (reasons.get(run.reason) ?? 0) + 1);
		}
		const top = [...reasons.entries()]
			.sort((a, b) => b[1] - a[1])
			.slice(0, 3)
			.map(([reason, count]) => `${reason} (${count})`)
			.join("; ");
		lines.push(
			`- ${id}: ${own.length} of ${runs.filter((run) => run.question === id).length} runs failed. ${top}`,
		);
	}
	return `${lines.join("\n")}\n`;
};

export const readRuns = async (dir: string): Promise<RunRecord[]> => {
	const text = await Bun.file(`${dir}/runs.jsonl`).text();
	return text
		.split("\n")
		.filter((line) => line.trim() !== "")
		.map((line) => runRecordSchema.parse(JSON.parse(line)));
};

export const writeReport = async (dir: string, title: string) => {
	const runs = await readRuns(dir);
	const ranked = rank(summarize(runs));
	await Bun.write(
		`${dir}/summary.json`,
		`${JSON.stringify(ranked, null, "\t")}\n`,
	);
	await Bun.write(`${dir}/summary.md`, markdown(title, ranked, runs));
	return ranked;
};

if (import.meta.main) {
	const { values, positionals } = parseArgs({
		allowPositionals: true,
		options: {
			title: { type: "string", default: "Assistant model benchmark" },
		},
	});
	const dir = positionals[0];
	if (!dir) throw new Error("Pass the results directory.");
	await writeReport(dir, values.title ?? "Assistant model benchmark");
	console.log(`wrote ${dir}/summary.md`);
}
