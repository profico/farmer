import { describe, expect, test } from "bun:test";

import {
	canonicalTaskName,
	groupForTaskName,
	STANDARD_TASKS,
	TASK_ALIASES,
	TASK_GROUPS,
} from "./task-taxonomy";

describe("the task taxonomy", () => {
	test("every alias folds into a standard task", () => {
		const names = new Set<string>(STANDARD_TASKS.map((t) => t.name));

		for (const target of Object.values(TASK_ALIASES)) {
			expect(names.has(target)).toBe(true);
		}
	});

	test("standard names are unique and grouped", () => {
		const names = STANDARD_TASKS.map((t) => t.name);
		expect(new Set(names).size).toBe(names.length);

		for (const t of STANDARD_TASKS) expect(TASK_GROUPS).toContain(t.group);
	});

	test("canonicalTaskName ignores case and spacing, and keeps the unknown", () => {
		expect(canonicalTaskName("  UI/UX   Design ")).toBe("Design");
		expect(canonicalTaskName("code review")).toBe("Code Review");
		expect(canonicalTaskName("Code Review and Instructions")).toBe(
			"Code Review",
		);
		expect(canonicalTaskName("iOS")).toBe("iOS");
		expect(canonicalTaskName("Something Bespoke")).toBe("Something Bespoke");
	});

	test("groupForTaskName follows the alias", () => {
		expect(groupForTaskName("Framer")).toBe("product");
		expect(groupForTaskName("AppleTV")).toBe("engineering");
		expect(groupForTaskName("Workshop")).toBe("learning");
		expect(groupForTaskName("Something Bespoke")).toBeNull();
	});
});
