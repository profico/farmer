/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";

import { isLocalFamily, localId, stackForId } from "./fonts.ts";

describe("device font ids", () => {
	test("accepts plain family names, including non-Latin ones", () => {
		for (const name of [
			"Comic Sans MS",
			"Noto Sans-2",
			"Fira_Code.v2",
			"思源黑体",
			"हिन्दी Sans",
			"Foo (Bold) +1",
		]) {
			expect(isLocalFamily(name)).toBe(true);
		}
	});

	test("refuses anything that could leave the quoted name", () => {
		const bad = [
			"",
			"a".repeat(65),
			"x'; color: red",
			'a"b',
			"a\\b",
			"a;b",
			"a:b",
			"a\nb",
			"a{b}",
		];
		for (const name of bad) expect(isLocalFamily(name)).toBe(false);
	});

	test("builds a quoted stack with the role's fallback", () => {
		expect(stackForId("mono", localId("Hack"))).toBe(
			"'Hack', ui-monospace, monospace",
		);
	});

	test("a stored id that is unsafe or unknown gives no stack", () => {
		expect(stackForId("body", "local:x'; y")).toBeNull();
		expect(stackForId("body", "nonsense")).toBeNull();
		expect(stackForId("body", "comic-sans")).toBe(
			"'Comic Sans MS', ui-sans-serif, system-ui, sans-serif",
		);
	});
});
