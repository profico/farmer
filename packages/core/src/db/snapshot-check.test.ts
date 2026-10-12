import { expect, test } from "bun:test";

import { missingSnapshot } from "./snapshot-check";

const journal = { entries: [{ idx: 0 }, { idx: 76 }] };

test("an empty journal needs no snapshot", () => {
	expect(missingSnapshot({ entries: [] }, [])).toBeNull();
});

test("the last entry has its snapshot", () => {
	expect(missingSnapshot(journal, ["0076_snapshot.json"])).toBeNull();
});

test("the last entry has no snapshot", () => {
	expect(missingSnapshot(journal, ["0075_snapshot.json"])).toBe(
		"0076_snapshot.json",
	);
	expect(missingSnapshot(journal, [])).toBe("0076_snapshot.json");
});
