/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";

import {
	afterClientChange,
	afterOrganizationChange,
	afterPeopleChange,
	afterSlackDisconnect,
	afterTaskChange,
	afterTimeChange,
	type Invalidator,
	settleAll,
} from "./invalidation";

const base = ["farmer", "https://farmer.test", "acme"] as const;

/** A client that records the keys it is asked to invalidate. */
const recorder = () => {
	const calls: { key: string; exact: boolean }[] = [];
	const client: Invalidator = {
		invalidateQueries: async ({ queryKey, exact }) => {
			calls.push({ key: queryKey.join("/"), exact: exact === true });
		},
	};
	return { client, keys: () => calls.map((call) => call.key), calls };
};

const scoped = (...parts: string[]) => [...base, ...parts].join("/");

describe("afterTimeChange", () => {
	test("the days, the reports and the timer; the timer by exact key", async () => {
		const { client, keys, calls } = recorder();
		await afterTimeChange(client, base);
		expect(keys()).toEqual(
			[
				"entries",
				"unfiled",
				"tracking",
				"home",
				"reports",
				"projects",
				"timer",
			].map((part) => scoped(part)),
		);
		expect(calls.filter((call) => call.exact).map((call) => call.key)).toEqual([
			scoped("timer"),
		]);
	});
});

describe("afterPeopleChange (the eleven people hooks)", () => {
	test("makes the whole workspace stale, so the reports and whoami follow", async () => {
		const { client, keys } = recorder();
		await afterPeopleChange(client, base);
		// The scope key is a prefix of every query of the workspace.
		expect(keys()).toEqual([scoped()]);
	});
});

describe("afterOrganizationChange (useUpdateOrganization)", () => {
	test("makes the whole workspace stale, and /me", async () => {
		const { client, keys } = recorder();
		const me = ["farmer", "https://farmer.test", "me"];
		await afterOrganizationChange(client, base, me);
		expect(keys()).toEqual([scoped(), me.join("/")]);
	});
});

describe("afterClientChange (create, rename, archive a client)", () => {
	test("the client lists, the projects and the reports", async () => {
		const { client, keys } = recorder();
		await afterClientChange(client, base);
		expect(keys()).toEqual([
			scoped("admin", "clients"),
			scoped("clients"),
			scoped("projects"),
			scoped("reports"),
		]);
	});
});

describe("afterTaskChange (create, update, archive a task)", () => {
	test("the task lists and the time keys", async () => {
		const { client, keys } = recorder();
		await afterTaskChange(client, base);
		expect(keys()).toContain(scoped("admin", "tasks"));
		expect(keys()).toContain(scoped("tasks"));
		for (const part of ["entries", "reports", "home", "tracking", "timer"]) {
			expect(keys()).toContain(scoped(part));
		}
	});
});

describe("afterSlackDisconnect (useDisconnectSlack)", () => {
	test("the reminder settings", async () => {
		const { client, keys } = recorder();
		await afterSlackDisconnect(client, base);
		expect(keys()).toEqual([scoped("admin", "reminders")]);
	});
});

describe("settleAll", () => {
	test("runs every call, then throws the first failure", async () => {
		const ran: string[] = [];
		const work = [
			Promise.reject(new Error("commits")).finally(() => ran.push("a")),
			Promise.resolve().then(() => ran.push("b")),
		];
		await expect(settleAll(work)).rejects.toThrow("commits");
		expect(ran.sort()).toEqual(["a", "b"]);
	});

	test("resolves when every call resolves", async () => {
		await expect(
			settleAll([Promise.resolve(1), Promise.resolve(2)]),
		).resolves.toBeUndefined();
	});
});
