import { expect, test } from "bun:test";

import { LOGO, LOGO_WIDTH, logoLines } from "./logo";

test("the source keeps the owner's trailing spaces", () => {
	expect(LOGO.split("\n")[0]).toHaveLength(LOGO_WIDTH);
});

test("the printed lines have no trailing spaces and fit the width", () => {
	const lines = logoLines();
	expect(lines).toHaveLength(15);

	for (const line of lines) {
		expect(line).toBe(line.trimEnd());
		expect(line.length).toBeLessThanOrEqual(LOGO_WIDTH);
	}

	expect(lines[1]).toBe("  @@@@      @@@");
});
