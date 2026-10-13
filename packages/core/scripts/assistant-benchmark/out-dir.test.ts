import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

import { resultsDir } from "./out-dir";

const here = resolve(import.meta.dir);
const results = resolve(here, "results");

describe("the results directory", () => {
	test("the default is under the ignored results directory", () => {
		expect(resultsDir(here, "", false, "2026-10-07")).toBe(
			resolve(results, "2026-10-07"),
		);
		expect(resultsDir(here, "", true, "2026-10-07")).toBe(
			resolve(results, "stub"),
		);
	});

	test("a relative --out is under results, not the working directory", () => {
		expect(resultsDir(here, "full-run", false, "2026-10-07")).toBe(
			resolve(results, "full-run"),
		);
		expect(resultsDir(here, "results/x", false, "2026-10-07")).toBe(
			resolve(results, "results/x"),
		);
	});

	test("a path in the repository outside results is refused", () => {
		const packageDir = resolve(here, "..", "..");
		expect(() =>
			resultsDir(here, resolve(packageDir, "results"), false, "2026-10-07"),
		).toThrow("--out must be under");
		expect(() => resultsDir(here, "../escape", false, "2026-10-07")).toThrow(
			"--out must be under",
		);
	});

	test("an absolute path outside the repository is used as it is", () => {
		expect(resultsDir(here, "/tmp/bench", false, "2026-10-07")).toBe(
			"/tmp/bench",
		);
	});
});
