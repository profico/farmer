/// <reference types="bun-types" />
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

import { QueryClient } from "@tanstack/react-query";

import * as actualEntryOptions from "#/lib/entry-options.ts";
import * as actualGithub from "#/server/github.ts";

// What happened, in order, across the mocked calls.
const calls: string[] = [];
let commitAttach: () => Promise<void> = async () => {};
let pullRequestAttach: () => Promise<void> = async () => {};

mock.module("#/server/github.ts", () => ({
	...actualGithub,
	attachCommitsToEntry: async () => {
		calls.push("attach commits");
		await commitAttach();
	},
	attachPullRequestsToEntry: async () => {
		calls.push("attach pull requests");
		await pullRequestAttach();
	},
}));
mock.module("#/lib/entry-options.ts", () => ({
	...actualEntryOptions,
	rememberLastPick: () => {
		calls.push("remember pick");
	},
	rememberEntryOptions: () => {
		calls.push("remember options");
	},
}));
mock.module("sonner", () => ({
	toast: {
		success: (text: string) => calls.push(`toast success: ${text}`),
		error: (text: string) => calls.push(`toast error: ${text}`),
	},
}));

const { finishSave } = await import("./add-block-save.ts");
type Saved = Parameters<typeof finishSave>[0];

const queryClient = new QueryClient();

const saved = (over: Partial<Saved> = {}): Saved => ({
	savedEntry: { id: "e1" },
	values: {
		projectId: "p1",
		taskId: "t1",
		date: "2026-09-15",
		duration: "1.5",
		description: "Work",
		overtime: false,
		fillsDay: false,
		repeatEnabled: false,
		daysOfWeek: [2],
		repeatEndDate: "",
	},
	entry: undefined,
	orgSlug: "acme",
	queryClient,
	defaultDate: "2026-09-15",
	// SAFETY: the save reads only the repo id, sha and number of a suggestion.
	suggestedCommits: [{ projectGithubRepoId: "r1", sha: "abc" }] as never,
	// SAFETY: the save reads only the repo id, sha and number of a suggestion.
	suggestedPullRequests: [{ projectGithubRepoId: "r1", number: 7 }] as never,
	selectedCommitKeys: new Set(["r1:abc"]),
	selectedPullRequestKeys: new Set(["r1:7"]),
	...over,
});

const rejects = (): Promise<void> => Promise.reject(new Error("boom"));

// Every test file runs in one process, so the next file gets the real one back.
const realConsoleError = console.error;
afterAll(() => {
	console.error = realConsoleError;
});

beforeEach(() => {
	calls.length = 0;
	commitAttach = async () => {};
	pullRequestAttach = async () => {};
	queryClient.invalidateQueries = async () => {
		calls.push("refresh");
	};
	console.error = () => {};
});

describe("finishSave", () => {
	test("attaches commits, then pull requests, then closes", async () => {
		await finishSave(saved(), () => calls.push("close"));
		const attach = calls.filter((c) => c.startsWith("attach"));
		expect(attach).toEqual(["attach commits", "attach pull requests"]);
		expect(calls.indexOf("close")).toBeGreaterThan(calls.indexOf("refresh"));
	});

	test("a pull request attach waits for the commit attach", async () => {
		let release: () => void = () => {};
		commitAttach = () =>
			new Promise<void>((resolve) => {
				release = resolve;
			});
		const done = finishSave(saved(), () => {});
		await Promise.resolve();
		await Promise.resolve();
		expect(calls).toEqual(["attach commits"]);
		release();
		await done;
		expect(calls[1]).toBe("attach pull requests");
	});

	test("a failed commit attach still tries pull requests, remembers, toasts, refreshes and closes", async () => {
		commitAttach = rejects;
		await finishSave(saved(), () => calls.push("close"));
		expect(calls).toContain("attach pull requests");
		expect(calls).toContain("remember pick");
		expect(calls).toContain("remember options");
		expect(calls).toContain(
			"toast error: Saved. The commits were not attached. Try again from the entry.",
		);
		expect(calls).toContain("refresh");
		expect(calls).toContain("close");
	});

	test("a failed pull request attach still closes and names only it", async () => {
		pullRequestAttach = rejects;
		await finishSave(saved(), () => calls.push("close"));
		expect(calls).toContain(
			"toast error: Saved. The pull requests were not attached. Try again from the entry.",
		);
		expect(calls).toContain("close");
	});

	test("logs the kind and the error of a failed attach", async () => {
		const logged: unknown[][] = [];
		console.error = (...args: unknown[]) => {
			logged.push(args);
		};
		commitAttach = rejects;
		await finishSave(saved(), () => {});
		expect(logged).toHaveLength(1);
		expect(String(logged[0]?.[0])).toContain("commits");
		expect(logged[0]?.[1]).toBeInstanceOf(Error);
	});
});
