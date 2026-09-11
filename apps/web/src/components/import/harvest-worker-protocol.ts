import type {
	HarvestChoices,
	HarvestFileInfo,
	HarvestPlan,
	HarvestSnapshot,
} from "@farmer/core/lib/harvest/index";
import type { HarvestImportDay } from "@farmer/core/schema";

// The messages between Settings → Import and `harvest.worker.ts`. The Worker
// keeps the parsed files and the latest plan's chunks; the page only ever
// holds the review half, because the real export is 240,000 rows and cloning
// them across `postMessage` on every changed choice is what froze the tab.

/** The plan without its days. The runner asks for them one chunk at a time. */
export type HarvestPlanView = Omit<HarvestPlan, "days">;

export type HarvestWorkerRequest =
	| { id: number; type: "parse"; files: { name: string; text: string }[] }
	| {
			id: number;
			type: "plan";
			snapshot: HarvestSnapshot;
			choices: HarvestChoices;
	  }
	| { id: number; type: "chunk"; planId: number; index: number };

export type HarvestWorkerResponse =
	| {
			id: number;
			type: "parsed";
			files: HarvestFileInfo[];
			range: { from: string; to: string } | null;
			candidateEmails: string[];
			choices: HarvestChoices;
	  }
	| {
			id: number;
			type: "plan";
			planId: number;
			plan: HarvestPlanView;
			chunkCount: number;
			rowsToSend: number;
	  }
	| { id: number; type: "chunk"; days: HarvestImportDay[] }
	| { id: number; type: "error"; message: string };
