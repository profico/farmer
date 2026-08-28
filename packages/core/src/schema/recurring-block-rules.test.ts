// The label said "(optional)" and the schema agreed, but the entries the rule
// generates are worked time and worked time must carry a note. The trap only
// sprang later: open one of those generated entries to change its hours and the
// edit dialog demands the note the rule had called optional, so the entry could
// not be saved at all. Issue #4.

import { describe, expect, test } from "bun:test";

import { createRecurringBlockRuleInput } from "./recurring-block-rules";

const TASK_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";

const base = {
	taskId: TASK_ID,
	daysOfWeek: [1, 2, 3],
	duration: "30m",
};

describe("createRecurringBlockRuleInput", () => {
	test("a rule against a project needs a note", () => {
		const result = createRecurringBlockRuleInput.safeParse({
			...base,
			projectId: PROJECT_ID,
		});
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.path).toEqual(["description"]);
	});

	test("whitespace is not a note", () => {
		expect(
			createRecurringBlockRuleInput.safeParse({
				...base,
				projectId: PROJECT_ID,
				description: "   ",
			}).success,
		).toBe(false);
	});

	test("a rule against a project with a note is fine", () => {
		expect(
			createRecurringBlockRuleInput.safeParse({
				...base,
				projectId: PROJECT_ID,
				description: "Daily standup",
			}).success,
		).toBe(true);
	});

	test("an absence rule carries no project and needs no note", () => {
		expect(createRecurringBlockRuleInput.safeParse(base).success).toBe(true);
	});
});
