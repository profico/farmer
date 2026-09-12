// The shapes the browser and `harvest-import.service.ts` exchange, apart from
// the Zod inputs in `schema/harvest-import.ts`. Types only, so this module is
// safe in a Worker.

// `close` is no longer written — history closes went with the month-end
// close — but mapping rows from older runs may still carry it.
export type HarvestMappingKind =
	| "client"
	| "project"
	| "task"
	| "person"
	| "close";

/** What the org already holds, as far as the plan needs to know. */
export interface HarvestSnapshot {
	/** Null when the org has no internal client yet; `start` creates it. */
	internalClientId: string | null;
	clients: {
		id: string;
		name: string;
		isInternal: boolean;
		archived: boolean;
	}[];
	projects: {
		id: string;
		clientId: string;
		name: string;
		code: string | null;
		type: string;
		archived: boolean;
	}[];
	/** The org's tasks and the site built-ins. */
	tasks: {
		id: string;
		name: string;
		scope: "site" | "organization";
		systemKey: string | null;
		isAbsence: boolean;
		archived: boolean;
	}[];
	members: {
		userId: string;
		name: string;
		email: string;
		role: string;
		archived: boolean;
		/** False for a person who has never signed in (no `account` row). */
		hasAccount: boolean;
		startDate: string | null;
	}[];
	/** Addresses from the request that belong to a user who is NOT a member
	 *  here. Lower case. A listed address may attach to such a user; a guessed
	 *  one must not. */
	takenEmails: string[];
	/** Source key to local id, from every earlier run that was not undone. */
	mappings: { kind: HarvestMappingKind; sourceKey: string; localId: string }[];
	/** Entries a person or an engine made here (no import key) in the range. */
	appEntries: {
		userId: string;
		date: string;
		projectId: string | null;
		taskId: string;
		durationSeconds: number;
		absence: boolean;
		/** A calendar meeting, a recurring block or a fill block. */
		automation: boolean;
	}[];
	/** For each person, the days that earlier runs imported, in the range:
	 *  `[date, dayDigest(keys), edited]`. `edited` is 1 when a person changed
	 *  one of that day's imported rows here. */
	importedDays: { userId: string; days: [string, string, 0 | 1][] }[];
}

/** What `importDays` did with one chunk. */
export interface HarvestImportDaysResult {
	inserted: number;
	deleted: number;
	/** Days whose key set was the same as the imported one. */
	unchangedDays: number;
	/** Days that changed in Harvest but that a person edited here: kept. */
	keptDays: { personSourceKey: string; date: string }[];
}

export interface HarvestFinishResult {
	automationLockedThrough: string;
}
