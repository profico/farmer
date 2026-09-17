import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";

import { getDeploymentInfo } from "#/server/about.ts";
import type { DeploymentInfo } from "#/server/deployment-info.ts";

/**
 * The one query key in this folder that does NOT name an organization, and the
 * reason is the rule rather than an exception to it: the org goes in a key
 * because a cached answer belongs to one workspace (see `queries/keys.ts`).
 * This answer belongs to the DEPLOYMENT — the same contributors and the same
 * commit in every workspace — so naming an org would only refetch the identical
 * list once per workspace somebody visits.
 *
 * It is also why this key is not in `queryKeys`: that factory's type says every
 * family is `[name, org]`, which is the invariant worth keeping.
 *
 * **It is also the one query in this folder that outlives the tab.** Everything
 * else here is somebody's time, which is wrong the moment they change it; this
 * is who wrote the app and which commit is running, which is wrong about twice
 * a week. Kept only in memory it was re-fetched on every page load, and the
 * card it feeds spent the first half-second of every visit not existing and
 * then appearing — a colophon at the foot of a settings screen has no business
 * announcing itself. The snapshot below is what removes that: a second visit
 * renders the card from the last answer in its first frame, and asks GitHub
 * nothing at all until the snapshot is older than the server's own cache.
 */

/** Where the last answer is kept between visits. */
const SNAPSHOT_KEY = "farmer:deployment-info";

/**
 * How long a stored answer is used as-is, matched to `CONTRIBUTORS_CACHE_MS` in
 * `server/deployment-info.ts` — a shorter one here would only ask the server
 * for the copy it is already holding.
 */
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

/**
 * Parsed rather than cast, because this comes off a device rather than off the
 * wire: it may have been written by a build whose `DeploymentInfo` had a
 * different shape, or by hand. The annotation on `readSnapshot` is what keeps
 * the two definitions in step — a field added to `DeploymentInfo` and not to
 * this schema fails the typecheck rather than silently arriving as `undefined`.
 */
const snapshotSchema = z.object({
	at: z.number(),
	info: z.object({
		contributors: z.array(
			z.object({
				login: z.string(),
				name: z.string(),
				avatarUrl: z.string(),
				profileUrl: z.string(),
				contributions: z.number(),
			}),
		),
		commit: z
			.object({ sha: z.string(), shortSha: z.string(), url: z.string() })
			.nullable(),
	}),
});

type Snapshot = { at: number; info: DeploymentInfo };

const readSnapshot = (): Snapshot | null => {
	if (import.meta.env.SSR) return null;

	try {
		const raw = window.localStorage.getItem(SNAPSHOT_KEY);

		if (raw === null) return null;
		const parsed = snapshotSchema.safeParse(JSON.parse(raw));

		return parsed.success ? parsed.data : null;
	} catch {
		// Blocked storage, or a value that is not JSON. Either way there is no
		// snapshot, which is the state of a first visit and already handled.
		return null;
	}
};

const writeSnapshot = (info: DeploymentInfo) => {
	if (import.meta.env.SSR) return;

	try {
		window.localStorage.setItem(
			SNAPSHOT_KEY,
			JSON.stringify({ at: Date.now(), info }),
		);
	} catch {
		// Private mode, or the quota. The card still works for this visit; it
		// just starts from nothing on the next one.
	}
};

/** Read once per process, not once per render: two cards mount this query and
 *  both re-render as the roster resolves. */
let snapshot: Snapshot | null | undefined;

export const deploymentInfoQuery = () => {
	if (snapshot === undefined) snapshot = readSnapshot();

	return queryOptions({
		queryKey: ["deployment-info"] as const,
		queryFn: async () => {
			const info = await getDeploymentInfo();
			writeSnapshot(info);

			return info;
		},
		staleTime: MAX_AGE_MS,
		// The card unmounts whenever the settings panel is swapped away, and the
		// default five minutes would make coming back a fetch. Nothing about this
		// answer expires with a tab.
		gcTime: Number.POSITIVE_INFINITY,
		// `initialDataUpdatedAt` is what makes the snapshot count as an answer
		// rather than a placeholder: `staleTime` is measured from when the data
		// was really fetched, so a recent snapshot fetches nothing and an old one
		// refreshes underneath a card that is already drawn.
		initialData: snapshot?.info,
		initialDataUpdatedAt: snapshot?.at,
	});
};
