import { createServerFn } from "@tanstack/react-start";

import type { ReleaseNote, WebChanges } from "./release-notes";

/**
 * The release notes for the public Changelog and the front page. Open to
 * anybody, like the pages that read them; the GitHub read behind them is
 * cached (`server/release-notes.ts`), so a visitor cannot spend the anonymous
 * budget faster than once every fifteen minutes.
 */
export const getReleaseNotes = createServerFn({ method: "GET" }).handler(
	async (): Promise<ReleaseNote[]> => {
		const { listReleaseNotes } = await import("./release-notes");
		return listReleaseNotes();
	},
);

/** The newest release, for the front page's pill, or null when there is none. */
export const getLatestReleaseNote = createServerFn({ method: "GET" }).handler(
	async (): Promise<ReleaseNote | null> => {
		const { listReleaseNotes } = await import("./release-notes");
		return (await listReleaseNotes())[0] ?? null;
	},
);

/** The web app's changes: the default branch's commits, the one this server
 *  runs marked. */
export const getWebChanges = createServerFn({ method: "GET" }).handler(
	async (): Promise<WebChanges> => {
		const { listWebChanges } = await import("./release-notes");
		return listWebChanges();
	},
);
