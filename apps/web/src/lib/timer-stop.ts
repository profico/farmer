// What the Stop form sends to confirm (issue #121). A timer that continues an
// entry reads the entry's project and note live on the server. The form holds a
// copy from the last refetch, and that copy can be older than an inline edit
// that is still in flight. So a field the person did not edit is left out, and
// the server keeps the entry's current value. A timer without an entry has no
// live value to keep, so it always sends both fields.

export type StopFields = {
	projectId: string | null;
	description: string;
};

export type StopPayloadFields = {
	projectId?: string | null;
	description?: string;
};

export const stopPayloadFields = ({
	continuing,
	form,
	filled,
}: {
	continuing: boolean;
	form: StopFields;
	/** The values the form was last filled with from the timer. */
	filled: StopFields | null;
}): StopPayloadFields => {
	const untouched = (key: keyof StopFields) =>
		continuing && filled !== null && form[key] === filled[key];
	const fields: StopPayloadFields = {};
	if (!untouched("projectId")) fields.projectId = form.projectId;
	if (!untouched("description")) fields.description = form.description.trim();
	return fields;
};
