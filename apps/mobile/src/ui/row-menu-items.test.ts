import { describe, expect, test } from "bun:test";

import { menuItemsOf } from "./row-menu-items";

const item = (label: string, destructive?: boolean) => ({
	label,
	icon: "edit" as const,
	destructive,
	onPress: () => undefined,
});

describe("menuItemsOf", () => {
	test("leaves out the entries that are not items", () => {
		const labels = menuItemsOf([item("Edit"), false, null, undefined]).map(
			(entry) => entry.label,
		);
		expect(labels).toEqual(["Edit"]);
	});

	test("puts the destructive items last and keeps the order", () => {
		const labels = menuItemsOf([
			item("Delete", true),
			item("Edit"),
			item("Archive", true),
			item("File"),
		]).map((entry) => entry.label);
		expect(labels).toEqual(["Edit", "File", "Delete", "Archive"]);
	});

	test("gives an empty list when no action is allowed", () => {
		expect(menuItemsOf([false, undefined])).toEqual([]);
	});
});
