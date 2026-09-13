// Which entries must say what was done.
//
// A description is mandatory on worked time and optional on the two kinds of
// entry where there is nothing to say: time off (Vacation, Sick Leave, Paid
// Leave — "Vacation" needs no elaboration) and a Break. The rule is keyed on the
// TASK, not on whether a project was chosen: Break sits on every project now
// and still needs no note, while a Meeting logged without a project is still
// worked time somebody will read about in a report.
//
// Pure, so the dialogs mark the field required with the same predicate the
// service refuses the save with.
export const descriptionRequiredFor = (task: {
	isAbsence: boolean;
	systemKey: string | null;
}) => !task.isAbsence && task.systemKey !== "break";
