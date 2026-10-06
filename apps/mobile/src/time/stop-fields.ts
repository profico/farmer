import type { ConfirmTimer, Timer } from "@farmer/api-client";

import { dayKeyInTimeZone } from "../lib/days";
import { toQuarter } from "../lib/duration";

// What the Stop screen sends to confirm (issue #121, #133). The server reads
// a continued entry's fields live, and a copy on the phone can be older than
// an edit that is still in flight. So the screen sends only a field that the
// person changed, and the server fills each other field. This mirrors
// `apps/web/src/lib/timer-stop.ts`: the mobile app cannot import from the web
// app.

export type StopFields = {
	seconds: number;
	date: string;
	projectId: string | null;
	taskId: string;
	description: string;
};

/** A field the person changed. A field that is not here follows the timer. */
export type StopEdits = Partial<StopFields>;

/** The values that the live timer offers. */
export const timerStopFields = (
	timer: Timer,
	timeZone: string,
): StopFields => ({
	// A continued entry stays on its own day; a new one lands on the day the
	// timer started, in the workspace's timezone.
	date:
		timer.entry?.date ?? dayKeyInTimeZone(new Date(timer.startedAt), timeZone),
	seconds: toQuarter(timer.snappedSeconds),
	projectId: timer.project?.id ?? null,
	taskId: timer.task.id,
	description: timer.description,
});

/** The form: each field is the person's edit, else the live timer value. */
export const stopFormFields = (
	live: StopFields,
	edits: StopEdits,
): StopFields => ({ ...live, ...edits });

/** Keep an edit only while it differs from the live value. */
const changed = <K extends keyof StopFields>(
	key: K,
	edits: StopEdits,
	live: StopFields,
): edits is StopEdits & Required<Pick<StopFields, K>> =>
	edits[key] !== undefined && edits[key] !== live[key];

export const stopPayload = ({
	timer,
	live,
	edits,
}: {
	timer: Timer;
	live: StopFields;
	edits: StopEdits;
}): ConfirmTimer => {
	const body: ConfirmTimer = {};
	if (changed("date", edits, live)) body.date = edits.date;
	if (changed("projectId", edits, live)) body.projectId = edits.projectId;
	if (changed("taskId", edits, live)) body.taskId = edits.taskId;
	if (changed("description", edits, live)) {
		// "" clears the note.
		body.description = edits.description.trim();
	}
	if (changed("seconds", edits, live)) {
		// A figure that the person corrected wins on the server.
		body.durationSeconds = edits.seconds;
	} else {
		// The figure shown, without the hours that the entry held: the server
		// adds the live entry hours, so an edit of them is kept.
		body.measuredSeconds = Math.max(
			0,
			live.seconds - (timer.entry?.durationSeconds ?? 0),
		);
	}
	return body;
};
