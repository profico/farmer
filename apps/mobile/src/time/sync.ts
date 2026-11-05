import type { SyncResult } from "@farmer/api-client";

/**
 * The words for the names of the sync steps. The server sends its own keys
 * (`timeEntriesService.runAutomations`), which are not for a person to read.
 */
const STEP_WORDS = new Map([
	["recurring-blocks", "recurring blocks"],
	["meetings", "calendar meetings"],
	["commit-work-time", "GitHub work time"],
	["org-settings", "workspace settings"],
	["integration-settings", "integration settings"],
]);

/** One step, in words. A key that this app does not know loses its hyphens. */
const stepWords = (key: string) =>
	STEP_WORDS.get(key) ?? key.replaceAll("-", " ");

const listWords = (keys: string[]) => keys.map(stepWords).join(", ");

/** What "Sync now" did, in one line. A warning when a source failed. */
export const syncMessage = (result: SyncResult) => {
	if (result.stillRunning) {
		return {
			message: "The sync takes longer than usual. It continues on the server.",
			warning: false,
		};
	}
	if (result.failed.length > 0) {
		return {
			message: `The sync failed for ${listWords(result.failed)}.`,
			warning: true,
		};
	}
	if (result.ran.length === 0) {
		return {
			message: "Nothing to sync. Connect a calendar or GitHub first.",
			warning: false,
		};
	}
	return { message: `Synced ${listWords(result.ran)}.`, warning: false };
};
