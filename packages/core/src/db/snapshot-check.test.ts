import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { metaProblem, missingSnapshot, newerSnapshot } from "./snapshot-check";

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

test("a newer leftover snapshot is found", () => {
	const files = ["0076_snapshot.json", "0077_snapshot.json"];
	expect(newerSnapshot(journal, files)).toBe("0077_snapshot.json");
	expect(newerSnapshot(journal, ["0076_snapshot.json"])).toBeNull();
	expect(newerSnapshot({ entries: [] }, files)).toBeNull();
});

describe("metaProblem", () => {
	let dir = "";
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "meta-"));
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));
	const write = (name: string, body = "{}") =>
		writeFileSync(join(dir, name), body);

	test("no journal means no problem", async () => {
		expect(await metaProblem(join(dir, "none"))).toBeNull();
	});

	test("an empty journal means no problem", async () => {
		write("_journal.json", JSON.stringify({ entries: [] }));
		expect(await metaProblem(dir)).toBeNull();
	});

	test("a good folder means no problem", async () => {
		write("_journal.json", JSON.stringify(journal));
		write("0076_snapshot.json");
		expect(await metaProblem(dir)).toBeNull();
	});

	test("a missing snapshot gives restore steps", async () => {
		write("_journal.json", JSON.stringify(journal));
		const message = await metaProblem(dir);
		expect(message).toContain("0076_snapshot.json is missing");
		expect(message).toContain("git checkout -- ':/packages/core");
		expect(message).toContain("git checkout HEAD -- ':/packages/core");
	});

	test("a stray file that sorts last is named", async () => {
		write("_journal.json", JSON.stringify(journal));
		write("0076_snapshot.json");
		write("0077_snapshot.json.bak");
		const message = await metaProblem(dir);
		expect(message).toContain("0077_snapshot.json.bak");
	});

	test("a leftover newer snapshot is named", async () => {
		write("_journal.json", JSON.stringify(journal));
		write("0076_snapshot.json");
		write("0077_snapshot.json");
		const message = await metaProblem(dir);
		expect(message).toContain("0077_snapshot.json");
		expect(message).toContain("Delete");
	});
});
