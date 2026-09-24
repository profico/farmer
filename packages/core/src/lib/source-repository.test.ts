import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { setInstanceSettingsForTests } from "./instance-settings";
import {
	configuredSourceRepository,
	DEFAULT_SOURCE_REPOSITORY,
	isRepositoryName,
	sourceRepository,
} from "./source-repository";

describe("isRepositoryName", () => {
	test("accepts owner/name as GitHub spells them", () => {
		for (const value of [
			"profico/farmer",
			"a-fork/farmer",
			"Someone/my.farmer_2",
			"x/.github",
		]) {
			expect(isRepositoryName(value)).toBe(true);
		}
	});

	// The value goes into API paths and links, so anything that could turn into
	// another URL is refused rather than escaped.
	test("refuses what would change the URL it goes into", () => {
		for (const value of [
			"",
			"farmer",
			"owner/",
			"/farmer",
			"owner/name/extra",
			"owner/..",
			"owner/.",
			"-owner/farmer",
			"owner/name?x=1",
			"owner/name#x",
			"own er/farmer",
			"https://github.com/owner/farmer",
		]) {
			expect(isRepositoryName(value)).toBe(false);
		}
	});
});

describe("sourceRepository", () => {
	const saved = process.env.CLI_RELEASES_REPO;

	beforeEach(() => {
		delete process.env.CLI_RELEASES_REPO;
	});

	afterEach(() => {
		setInstanceSettingsForTests(undefined);
		// Assigning `undefined` would store the string "undefined".
		if (saved === undefined) delete process.env.CLI_RELEASES_REPO;
		else process.env.CLI_RELEASES_REPO = saved;
	});

	test("is upstream when nothing sets it", () => {
		setInstanceSettingsForTests({});
		expect(sourceRepository()).toBe(DEFAULT_SOURCE_REPOSITORY);
	});

	test("follows the setting, so a fork points at itself", () => {
		setInstanceSettingsForTests({ CLI_RELEASES_REPO: "a-fork/farmer" });
		expect(sourceRepository()).toBe("a-fork/farmer");
	});

	test("the environment wins over the database", () => {
		setInstanceSettingsForTests({ CLI_RELEASES_REPO: "db/farmer" });
		process.env.CLI_RELEASES_REPO = "env/farmer";
		expect(sourceRepository()).toBe("env/farmer");
	});

	test("a malformed value is null, and the raw value is still readable", () => {
		setInstanceSettingsForTests({ CLI_RELEASES_REPO: "not a repo" });
		expect(sourceRepository()).toBeNull();
		expect(configuredSourceRepository()).toBe("not a repo");
	});
});
