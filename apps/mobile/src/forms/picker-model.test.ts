import { describe, expect, test } from "bun:test";

/// <reference types="bun-types" />
import type { Project, Task } from "@farmer/api-client";

import {
	matchesProject,
	offeredTasks,
	projectSections,
	showsNoProject,
	taskSections,
} from "./picker-model";

const project = (
	id: string,
	name: string,
	client: string,
	code: string | null = null,
	status: Project["status"] = "active",
): Project => {
	const base: Pick<Project, "id" | "name" | "code" | "client" | "status"> = {
		id,
		name,
		code,
		status,
		client: { id: client, name: client },
	};
	// SAFETY: the picker reads only id, name, code and client of a project.
	return base as Project;
};

const task = (id: string, name: string, group: string): Task => ({
	id,
	name,
	group,
	isAbsence: false,
	systemKey: null,
});

const titles = (sections: { title: string | null }[]) =>
	sections.map((section) => section.title);

const projects = [
	project("1", "website", "beta"),
	project("2", "Api", "Alpha", "A-1"),
	project("3", "app", "alpha"),
	project("4", "Zeta", "Alpha"),
];

describe("projectSections", () => {
	test("hides an archived project, except the chosen one", () => {
		const list = [
			project("1", "Live", "Acme"),
			project("2", "Old", "Acme", null, "archived"),
		];
		const names = (chosenId: string | null) =>
			projectSections(list, "", false, chosenId).flatMap((section) =>
				section.data.map((item) =>
					item.kind === "project" ? item.project.name : "",
				),
			);
		expect(names(null)).toEqual(["Live"]);
		expect(names("2")).toEqual(["Live", "Old"]);
	});

	test("sorts the clients and the projects with no regard to case", () => {
		const sections = projectSections(projects, "", false);
		expect(titles(sections)).toEqual(["Alpha", "alpha", "beta"]);
		const alpha = sections.find((section) => section.title === "Alpha");
		expect(
			alpha?.data.map((item) =>
				item.kind === "project" ? item.project.name : "",
			),
		).toEqual(["Api", "Zeta"]);
	});

	test("matches the name, the code and the client", () => {
		const names = (search: string) =>
			projectSections(projects, search, false).flatMap((section) =>
				section.data.map((item) =>
					item.kind === "project" ? item.project.name : "",
				),
			);
		expect(names("WEB")).toEqual(["website"]);
		expect(names("a-1")).toEqual(["Api"]);
		expect(names("beta")).toEqual(["website"]);
		expect(names("nothing")).toEqual([]);
	});

	test("puts the No project row first, and only for a fitting search", () => {
		expect(titles(projectSections(projects, "", true))[0]).toBeNull();
		expect(titles(projectSections(projects, "no pro", true))[0]).toBeNull();
		expect(titles(projectSections(projects, "web", true))[0]).toBe("beta");
		expect(titles(projectSections(projects, "", false))).not.toContain(null);
	});

	test("gives no section when nothing matches", () => {
		expect(projectSections(projects, "zzz", false)).toEqual([]);
	});
});

describe("showsNoProject", () => {
	test("accepts an empty search and a part of the name", () => {
		expect(showsNoProject("  ")).toBe(true);
		expect(showsNoProject("project")).toBe(true);
		expect(showsNoProject("web")).toBe(false);
	});
});

describe("matchesProject", () => {
	test("ignores the space around the search", () => {
		const [first] = projects;
		expect(first && matchesProject(first, "  WEBSITE ")).toBe(true);
	});
});

describe("tasks", () => {
	const work = [
		task("a", "Design", "Work"),
		task("b", "Review", "Work"),
		task("c", "Standup", "Meetings"),
	];
	const absence = [task("d", "Holiday", "Time off")];

	test("hides a hidden task, but keeps the chosen one", () => {
		const hidden = new Set(["a", "b"]);
		expect(
			offeredTasks(work, absence, hidden, "b", false).map((t) => t.id),
		).toEqual(["b", "c"]);
	});

	test("adds the absence tasks on request", () => {
		const none = new Set<string>();
		expect(offeredTasks(work, absence, none, null, false)).toHaveLength(3);
		expect(
			offeredTasks(work, absence, none, null, true).map((t) => t.id),
		).toEqual(["a", "b", "c", "d"]);
	});

	test("keeps the order of the server and searches name and group", () => {
		expect(titles(taskSections(work, ""))).toEqual(["Work", "Meetings"]);
		expect(titles(taskSections(work, "meet"))).toEqual(["Meetings"]);
		const found = taskSections(work, "REV");
		expect(found.map((section) => section.data.map((t) => t.id))).toEqual([
			["b"],
		]);
		expect(taskSections(work, "zzz")).toEqual([]);
	});
});
