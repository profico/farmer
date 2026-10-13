import { z } from "zod";

// A filing rule is created from the File-your-time dialog rather than typed.
// `fileTimeEntriesInput`'s `remember` flag is what creates them — see
// time-entries.ts and the note on `filingRulesService.rememberFrom` for why the
// rule is derived from the entries that were just filed rather than sent as its
// own payload.

export const deleteFilingRuleInput = z.object({ id: z.uuid() });
export type DeleteFilingRuleInput = z.infer<typeof deleteFilingRuleInput>;

// Only the answer is editable, never the key. The title and the meeting task
// are what the sync matches on; a rule with a different title is a different
// rule, and that one is made by filing the meeting.
export const updateFilingRuleInput = z.object({
	id: z.uuid(),
	projectId: z.uuid(),
	/** Null keeps the meeting's own task. */
	targetTaskId: z.uuid().nullable(),
});
export type UpdateFilingRuleInput = z.infer<typeof updateFilingRuleInput>;

// A rule made from entries the person already filed. The entries name the
// rule: the key is each entry's task and note, and the answer is the project
// each entry is on. The caller sends no project, task or title of its own, so
// it cannot make a rule for something that was not filed.
export const MAX_REMEMBER_ENTRIES = 50;
export const rememberFilingRuleInput = z.object({
	timeEntryIds: z.array(z.uuid()).min(1).max(MAX_REMEMBER_ENTRIES),
});
export type RememberFilingRuleInput = z.infer<typeof rememberFilingRuleInput>;
