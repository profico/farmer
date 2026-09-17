// The upload sweep, on what it must NOT delete. Deleting too little costs a
// megabyte; deleting too much breaks an icon somebody chose, so every rule that
// keeps a file is pinned here, next to the one case that removes it.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { db } from "../db";
import { organization } from "../db/schema/auth";
import { client, project } from "../db/schema/domain";
import { type ObjectStore, setObjectStoreForTests } from "../lib/storage";
import { uploadKey, uploadPath } from "../lib/uploads";
import { createTestDb, present, type TestDb } from "../test/harness";
import { runUploadSweepOnce, UPLOAD_SWEEP_GRACE_MS } from "./upload-sweep";

const ORG = "org-sweep";

const NOW = new Date("2026-09-14T12:00:00Z");

const OLD = new Date(NOW.getTime() - UPLOAD_SWEEP_GRACE_MS - 60_000);

const YOUNG = new Date(NOW.getTime() - 60_000);

const key = (organizationId: string, purpose: "project-icon" | "org-logo") =>
	uploadKey(organizationId, purpose, crypto.randomUUID(), "png");

const UNUSED = key(ORG, "project-icon");

const ICON = key(ORG, "project-icon");

const LOGO = key(ORG, "org-logo");

const FRESH = key(ORG, "project-icon");

const ELSEWHERE = key("org-this-database-never-had", "org-logo");

const FOREIGN = "orgs/notes/readme.txt";

let harness: TestDb;

const objects = new Map<string, Date>();

const store: ObjectStore = {
	put: async () => {},
	get: async () => null,
	list: async function* (prefix) {
		for (const [objectKey, lastModified] of objects) {
			if (objectKey.startsWith(prefix)) {
				yield { key: objectKey, lastModified };
			}
		}
	},
	delete: async (objectKey) => {
		objects.delete(objectKey);
	},
};

beforeAll(async () => {
	harness = await createTestDb();
	setObjectStoreForTests(store);

	await db.insert(organization).values({
		id: ORG,
		name: ORG,
		slug: ORG,
		logo: uploadPath(LOGO),
		createdAt: new Date(),
	});

	const [acme] = await db
		.insert(client)
		.values({ organizationId: ORG, name: "Acme" })
		.returning();

	await db.insert(project).values([
		{
			organizationId: ORG,
			clientId: present(acme, "client").id,
			name: "With an icon",
			icon: uploadPath(ICON),
		},
		{
			organizationId: ORG,
			clientId: present(acme, "client").id,
			name: "With an emoji",
			icon: "🚜",
		},
	]);

	for (const objectKey of [UNUSED, ICON, LOGO, ELSEWHERE, FOREIGN]) {
		objects.set(objectKey, OLD);
	}

	objects.set(FRESH, YOUNG);
});

afterAll(async () => {
	setObjectStoreForTests(undefined);
	await harness.close();
});

describe("runUploadSweepOnce", () => {
	test("deletes only the old upload that nothing uses", async () => {
		const summary = await runUploadSweepOnce({ now: NOW });

		expect(summary).toEqual({
			enabled: true,
			listed: 6,
			deleted: 1,
			failed: 0,
		});
		expect(objects.has(UNUSED)).toBe(false);
		// A project icon and an organization logo still point at these.
		expect(objects.has(ICON)).toBe(true);
		expect(objects.has(LOGO)).toBe(true);
		// Uploaded a minute ago: its save may still be on the way.
		expect(objects.has(FRESH)).toBe(true);
		// An organization this database does not have, and a key this app never
		// writes, belong to somebody else.
		expect(objects.has(ELSEWHERE)).toBe(true);
		expect(objects.has(FOREIGN)).toBe(true);
	});

	test("a deployment with no store does nothing", async () => {
		setObjectStoreForTests(null);

		try {
			expect(await runUploadSweepOnce({ now: NOW })).toEqual({
				enabled: false,
				listed: 0,
				deleted: 0,
				failed: 0,
			});
		} finally {
			setObjectStoreForTests(store);
		}
	});
});
