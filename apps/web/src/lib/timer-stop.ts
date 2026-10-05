// What the Stop form sends to confirm (issue #121). A timer that continues an
// entry reads the entry's fields live on the server, and a timer without one
// reads its own copy. The form holds a copy from the last refetch, and that
// copy can be older than an edit that is still in flight. So a field the person
// did not edit is left out, and the server fills it with the live value.

export type StopFields = {
	duration: string;
	date: string;
	projectId: string | null;
	taskId: string;
	description: string;
};

export type StopPayloadFields = {
	date?: string;
	projectId?: string | null;
	taskId?: string;
	description?: string;
	durationSeconds?: number;
	measuredSeconds?: number;
};

export const stopPayloadFields = ({
	form,
	filled,
	seconds,
	entrySeconds,
}: {
	form: StopFields;
	/** The form's duration, read and snapped. */
	seconds: number;
	/** What the entry held, which the figure already includes. */
	entrySeconds: number;
	/** The values the form was last filled with from the timer. */
	filled: StopFields | null;
}): StopPayloadFields => {
	const untouched = (key: keyof StopFields) =>
		filled !== null && form[key] === filled[key];
	const fields: StopPayloadFields = {};
	if (!untouched("date")) fields.date = form.date;
	if (!untouched("projectId")) fields.projectId = form.projectId;
	if (!untouched("taskId")) fields.taskId = form.taskId;
	if (!untouched("description")) fields.description = form.description.trim();
	// An untouched figure is sent as its measured part, so the server adds the
	// entry's live hours and the person's inline edit survives.
	if (untouched("duration")) {
		fields.measuredSeconds = Math.max(0, seconds - entrySeconds);
	} else {
		fields.durationSeconds = seconds;
	}
	return fields;
};
