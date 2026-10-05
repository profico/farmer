import type { SyncResult } from "@farmer/api-client";

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
			message: `The sync failed for ${result.failed.join(", ")}.`,
			warning: true,
		};
	}
	if (result.ran.length === 0) {
		return {
			message: "Nothing to sync. Connect a calendar or GitHub first.",
			warning: false,
		};
	}
	return { message: `Synced ${result.ran.join(", ")}.`, warning: false };
};
