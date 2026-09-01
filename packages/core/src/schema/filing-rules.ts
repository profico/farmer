import { z } from "zod";

// A filing rule is created from the File-your-time dialog rather than typed, so
// the only hand-written input here is the delete. `fileTimeEntriesInput`'s
// `remember` flag is what creates them — see time-entries.ts and the note on
// `filingRulesService.rememberFrom` for why the rule is derived from the
// entries that were just filed rather than sent as its own payload.

export const deleteFilingRuleInput = z.object({ id: z.uuid() });
export type DeleteFilingRuleInput = z.infer<typeof deleteFilingRuleInput>;
