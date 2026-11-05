import { expect, test } from "bun:test";

import { ASSISTANT_TOOLS } from "@farmer/core/services";

import { TOOL_LABELS, toolLabel } from "./tool-labels.ts";

test("every assistant tool has a label", () => {
	const missing = ASSISTANT_TOOLS.map((tool) => tool.name).filter(
		(name) => !TOOL_LABELS.has(name),
	);
	expect(missing).toEqual([]);
});

test("a tool without a label starts with a capital letter", () => {
	expect(toolLabel("some_new_tool")).toBe("Some new tool");
});
