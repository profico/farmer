import {
	chunkDays,
	defaultHarvestChoices,
	type ParsedHarvest,
	parseHarvestFiles,
	planHarvestImport,
} from "@farmer/core/lib/harvest/index";
import type { HarvestImportDay } from "@farmer/core/schema";

import type {
	HarvestWorkerRequest,
	HarvestWorkerResponse,
} from "./harvest-worker-protocol.ts";

// Parses the Harvest export and builds the plan off the main thread: the real
// time report takes about five seconds to parse and half a second to plan,
// and the plan is rebuilt on every choice the admin makes.

let parsed: ParsedHarvest | null = null;

let planId = 0;

let chunks: HarvestImportDay[][] = [];

const reply = (message: HarvestWorkerResponse) => self.postMessage(message);

async function handle(
	req: HarvestWorkerRequest,
): Promise<HarvestWorkerResponse> {
	switch (req.type) {
		case "parse": {
			parsed = await parseHarvestFiles(req.files);

			return {
				id: req.id,
				type: "parsed",
				files: parsed.files,
				range: parsed.range,
				candidateEmails: parsed.candidateEmails,
				choices: defaultHarvestChoices(parsed),
			};
		}

		case "plan": {
			if (!parsed) throw new Error("Drop the files again.");

			const { days, ...plan } = planHarvestImport(
				parsed,
				req.snapshot,
				req.choices,
			);

			planId += 1;
			chunks = chunkDays(days);

			return {
				id: req.id,
				type: "plan",
				planId,
				plan,
				chunkCount: chunks.length,
				rowsToSend: days.reduce((n, d) => n + d.rows.length, 0),
			};
		}

		case "chunk": {
			// A newer plan replaced the chunks this one asked for: sending them
			// would import days the admin has since changed their mind about.
			if (req.planId !== planId) {
				throw new Error("The plan changed during the import. Start again.");
			}

			const days = chunks[req.index];

			if (!days) throw new Error(`The plan has no chunk ${req.index + 1}.`);

			return { id: req.id, type: "chunk", days };
		}
	}
}

self.addEventListener(
	"message",
	(event: MessageEvent<HarvestWorkerRequest>) => {
		const req = event.data;
		handle(req).then(reply, (err: Error) =>
			reply({ id: req.id, type: "error", message: err.message }),
		);
	},
);
