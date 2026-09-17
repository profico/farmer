/**
 * The stopwatch as the REST API answers it (issues #59 and #43).
 *
 * A projection, never the row — the rule of this folder. Two fields are here
 * only because a client cannot work them out for itself and must not guess:
 *
 *   - `snappedSeconds`, what confirming would log. The snap rounds to the
 *     NEAREST quarter hour, so it is as often below the measured time as above
 *     it, and a client that rounded up would show a figure the server would
 *     not write.
 *   - `serverNow`, the instant the elapsed figure was measured against. A
 *     terminal or a browser draws its own ticking figure from `startedAt`, and
 *     a machine whose clock is five minutes out would otherwise count five
 *     minutes that the server will not agree to.
 */

export type ApiTimer = {
	id: string;
	/** ISO 8601, UTC. */
	startedAt: string;
	/** Set when the sweep dropped the timer for passing the person's limit:
	 *  nothing was logged, and this is the notice. Null while it runs. */
	droppedAt: string | null;
	elapsedSeconds: number;
	snappedSeconds: number;
	serverNow: string;
	description: string;
	task: { id: string; name: string };
	project: { id: string; name: string } | null;
	/** The workspace the entry will land in. A timer belongs to the person, not
	 *  to a workspace, so a client reading from another one still sees it and
	 *  can say where it is running. */
	organization: { slug: string; name: string; here: boolean };
};

export type TimerSource = {
	id: string;
	organizationSlug: string;
	organizationName: string;
	here: boolean;
	projectId: string | null;
	projectName: string | null;
	taskId: string;
	taskName: string;
	description: string;
	startedAt: Date;
	droppedAt: Date | null;
	elapsedSeconds: number;
	snappedSeconds: number;
	serverNow: Date;
};

export const toApiTimer = (row: TimerSource): ApiTimer => ({
	id: row.id,
	startedAt: row.startedAt.toISOString(),
	droppedAt: row.droppedAt ? row.droppedAt.toISOString() : null,
	elapsedSeconds: row.elapsedSeconds,
	snappedSeconds: row.snappedSeconds,
	serverNow: row.serverNow.toISOString(),
	description: row.description,
	task: { id: row.taskId, name: row.taskName },
	project:
		row.projectId && row.projectName
			? { id: row.projectId, name: row.projectName }
			: null,
	organization: {
		slug: row.organizationSlug,
		name: row.organizationName,
		here: row.here,
	},
});

/** `GET /api/v1/orgs/$slug/timer` when nobody is timing. Null rather than an
 *  absent body: `apiRoute` answers what the handler returns, and `undefined` is
 *  not JSON. */
export type ApiTimerState = { timer: ApiTimer | null };
