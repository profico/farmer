// Run the assistant benchmark.
//
//   OPENROUTER_API_KEY=... bun run bench:assistant
//   bun run bench:assistant -- --stub        (no key, no cost)
//
// The runner starts one child process for each model (see `child.ts`), reads
// the finished runs from the child output, and stops every child when the
// spend passes the cap. It never prints the key. A run that was stopped can
// continue: start it again with the same `--out`, and finished runs are kept.

import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { z } from "zod";

import { MODELS } from "./models";
import { resultsDir } from "./out-dir";
import { QUESTIONS } from "./questions";
import { writeReport } from "./report";
import { RUN_PREFIX, type RunRecord, runRecordSchema } from "./types";

const here = dirname(fileURLToPath(import.meta.url));

const { values } = parseArgs({
	options: {
		models: { type: "string", default: "" },
		questions: { type: "string", default: "" },
		repeats: { type: "string", default: "3" },
		// Children that run at the same time. Use 1 for a clean latency figure.
		concurrency: { type: "string", default: "3" },
		cap: { type: "string", default: "8" },
		out: { type: "string", default: "" },
		title: { type: "string", default: "Assistant model benchmark" },
		stub: { type: "boolean", default: false },
	},
});

const stub = values.stub;
const repeats = Number(values.repeats);
const cap = Number(values.cap);
const concurrency = Number(values.concurrency);
const out = resultsDir(
	here,
	values.out,
	stub,
	new Date().toISOString().slice(0, 10),
);

if (!stub && !process.env.OPENROUTER_API_KEY) {
	throw new Error(
		"Set OPENROUTER_API_KEY, or pass --stub to run without a paid call.",
	);
}

const catalogSchema = z.object({
	data: z.array(
		z.object({
			id: z.string(),
			expiration_date: z.string().nullable().optional(),
			supported_parameters: z.array(z.string()).optional(),
			pricing: z
				.object({ prompt: z.string(), completion: z.string() })
				.optional(),
		}),
	),
});

/** Check each model against the public catalog. Return what may run. */
const usable = async (ids: string[]) => {
	if (stub) return ids.map((id) => ({ id, price: "0,0" }));
	const response = await fetch("https://openrouter.ai/api/v1/models");
	if (!response.ok) throw new Error(`The catalog answered ${response.status}.`);
	const catalog = catalogSchema.parse(await response.json());
	const now = Date.now();
	const kept: { id: string; price: string }[] = [];
	for (const id of ids) {
		const entry = catalog.data.find((item) => item.id === id);
		if (!entry) {
			console.error(`drop ${id}: not in the catalog`);
		} else if (
			entry.expiration_date &&
			Date.parse(entry.expiration_date) <= now
		) {
			console.error(`drop ${id}: expired on ${entry.expiration_date}`);
		} else if (!entry.supported_parameters?.includes("tools")) {
			console.error(`drop ${id}: no tool support`);
		} else {
			kept.push({
				id,
				price: `${entry.pricing?.prompt ?? "0"},${entry.pricing?.completion ?? "0"}`,
			});
		}
	}
	return kept;
};

await mkdir(out, { recursive: true });
const runsFile = `${out}/runs.jsonl`;
const existing: RunRecord[] = (await Bun.file(runsFile).exists())
	? (await Bun.file(runsFile).text())
			.split("\n")
			.filter((line) => line.trim() !== "")
			.map((line) => runRecordSchema.parse(JSON.parse(line)))
	: [];

const requested = values.models
	? values.models.split(",").filter(Boolean)
	: MODELS;
const models = await usable(requested);
let spent = existing.reduce((sum, run) => sum + run.costUsd, 0);
let stopped = false;
const children = new Set<ReturnType<typeof Bun.spawn>>();

const runModel = async (model: { id: string; price: string }) => {
	if (stopped) return;
	const done = existing
		.filter((run) => run.model === model.id)
		.map((run) => `${run.question}:${run.repeat}`);
	const args = [
		"bun",
		`${here}/child.ts`,
		"--model",
		model.id,
		"--repeats",
		String(repeats),
		"--questions",
		values.questions ?? "",
		"--done",
		done.join(","),
		"--price",
		model.price,
		...(stub ? ["--stub"] : []),
	];
	const safeName = model.id.replaceAll(/[^a-z0-9.-]/gi, "_");
	const log = Bun.file(`${out}/${safeName}.log`).writer();
	const child = Bun.spawn(args, {
		stdout: "pipe",
		stderr: "pipe",
		env: process.env,
	});
	children.add(child);
	// Child errors go to a log. They can hold the provider's own text, and they
	// never hold the key.
	void (async () => {
		for await (const chunk of child.stderr) log.write(chunk);
		await log.end();
	})();
	const decoder = new TextDecoder();
	let buffer = "";
	for await (const chunk of child.stdout) {
		buffer += decoder.decode(chunk, { stream: true });
		const lines = buffer.split("\n");
		buffer = lines.pop() ?? "";
		for (const line of lines) {
			if (!line.startsWith(RUN_PREFIX)) continue;
			const run = runRecordSchema.parse(
				JSON.parse(line.slice(RUN_PREFIX.length)),
			);
			await appendFile(runsFile, `${JSON.stringify(run)}\n`);
			spent += run.costUsd;
			console.error(
				`${run.pass ? "PASS" : "FAIL"} ${run.model} ${run.question} #${run.repeat} ${(run.wallMs / 1000).toFixed(1)}s ${usdText(run.costUsd)} total ${usdText(spent)}${run.pass ? "" : ` (${run.reason})`}`,
			);
			if (spent >= cap && !stopped) {
				stopped = true;
				console.error(`The spend passed the cap of $${cap}. Stopping.`);
				for (const other of children) other.kill();
			}
		}
	}
	await child.exited;
	children.delete(child);
};

const usdText = (value: number) => `$${value.toFixed(4)}`;

const queue = [...models];
await Promise.all(
	Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
		for (let next = queue.shift(); next; next = queue.shift()) {
			await runModel(next);
		}
	}),
);

const ranked = await writeReport(
	out,
	values.title ?? "Assistant model benchmark",
);
console.error(
	`${QUESTIONS.length} questions, ${ranked.length} models, spent ${usdText(spent)}. Wrote ${out}/summary.md.`,
);
process.exit(stopped ? 2 : 0);
