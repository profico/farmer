// Uploaded project icons and organization logos.
//
// Three things are pinned: who may upload for which purpose, that the type is
// read from the bytes rather than trusted, and that a saved icon or logo may
// not point at a file another organization uploaded.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { db } from "../db";
import { member, organization, user } from "../db/schema/auth";
import {
	type ObjectStore,
	ObjectStoreFullError,
	setObjectStoreForTests,
} from "../lib/storage";
import {
	isUploadedFile,
	uploadKeyOf,
	uploadOrganizationOf,
} from "../lib/uploads";
import { createTestDb, present, type TestDb } from "../test/harness";
import { AccessError } from "./access.service";
import { organizationService } from "./organization.service";
import type { Ctx } from "./types";
import { UploadRejectedError, uploadsService } from "./uploads.service";

const ORG_A = "up-a";

const ORG_B = "up-b";

const ADMIN = "u-up-admin";

const MEM = "u-up-member";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);

let harness: TestDb;

const stored = new Map<string, { bytes: Uint8Array; contentType: string }>();

const memoryStore: ObjectStore = {
	put: async (key, bytes, contentType) => {
		stored.set(key, { bytes, contentType });
	},
	get: async () => null,
	list: async function* () {},
	delete: async () => {},
};

const ctx = (userId: string, organizationId: string = ORG_A): Ctx => ({
	organizationId,
	userId,
});

beforeAll(async () => {
	harness = await createTestDb();
	setObjectStoreForTests(memoryStore);

	await db.insert(organization).values(
		[ORG_A, ORG_B].map((id) => ({
			id,
			name: id,
			slug: id,
			createdAt: new Date(),
		})),
	);
	await db.insert(user).values(
		[ADMIN, MEM].map((id) => ({
			id,
			name: id,
			email: `${id}@example.com`,
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		})),
	);
	await db.insert(member).values([
		{
			id: "m-up-admin-a",
			organizationId: ORG_A,
			userId: ADMIN,
			role: "owner",
			createdAt: new Date(),
		},
		{
			id: "m-up-admin-b",
			organizationId: ORG_B,
			userId: ADMIN,
			role: "owner",
			createdAt: new Date(),
		},
		{
			id: "m-up-member",
			organizationId: ORG_A,
			userId: MEM,
			role: "member",
			createdAt: new Date(),
		},
	]);
});

afterAll(async () => {
	setObjectStoreForTests(undefined);
	await harness.close();
});

describe("uploadImage", () => {
	test("stores the image under the caller's organization", async () => {
		const { url } = await uploadsService.uploadImage(ctx(ADMIN), {
			purpose: "org-logo",
			bytes: PNG,
		});

		expect(isUploadedFile(url)).toBe(true);
		const key = present(uploadKeyOf(url), "upload key");
		expect(uploadOrganizationOf(key)).toBe(ORG_A);
		expect(stored.get(key)?.contentType).toBe("image/png");
	});

	test("a plain member may upload neither a logo nor a project icon", async () => {
		await expect(
			uploadsService.uploadImage(ctx(MEM), { purpose: "org-logo", bytes: PNG }),
		).rejects.toThrow(AccessError);
		await expect(
			uploadsService.uploadImage(ctx(MEM), {
				purpose: "project-icon",
				bytes: PNG,
			}),
		).rejects.toThrow(AccessError);
	});

	test("the type comes from the bytes, and the size is capped", async () => {
		const html = new TextEncoder().encode("<html><script>1</script></html>");
		await expect(
			uploadsService.uploadImage(ctx(ADMIN), {
				purpose: "project-icon",
				bytes: html,
			}),
		).rejects.toThrow(UploadRejectedError);

		const large = new Uint8Array(1024 * 1024 + 1);
		large.set(PNG);
		await expect(
			uploadsService.uploadImage(ctx(ADMIN), {
				purpose: "project-icon",
				bytes: large,
			}),
		).rejects.toThrow(UploadRejectedError);
	});

	test("a deployment with no store refuses", async () => {
		setObjectStoreForTests(null);

		try {
			await expect(
				uploadsService.uploadImage(ctx(ADMIN), {
					purpose: "org-logo",
					bytes: PNG,
				}),
			).rejects.toThrow(UploadRejectedError);
		} finally {
			setObjectStoreForTests(memoryStore);
		}
	});

	test("a full bucket is told to the person, not hidden as a server error", async () => {
		setObjectStoreForTests({
			...memoryStore,
			put: async () => {
				throw new ObjectStoreFullError("quota");
			},
		});

		try {
			await expect(
				uploadsService.uploadImage(ctx(ADMIN), {
					purpose: "org-logo",
					bytes: PNG,
				}),
			).rejects.toThrow(/no space left/);
		} finally {
			setObjectStoreForTests(memoryStore);
		}
	});
});

describe("saving an upload", () => {
	test("an organization's logo may be its own upload", async () => {
		const { url } = await uploadsService.uploadImage(ctx(ADMIN), {
			purpose: "org-logo",
			bytes: PNG,
		});

		const saved = await organizationService.updateSettings(ctx(ADMIN), {
			logo: url,
		});

		expect(saved.logo).toBe(url);
	});

	test("but not another organization's", async () => {
		const { url } = await uploadsService.uploadImage(ctx(ADMIN, ORG_B), {
			purpose: "org-logo",
			bytes: PNG,
		});

		await expect(
			organizationService.updateSettings(ctx(ADMIN), { logo: url }),
		).rejects.toThrow(UploadRejectedError);
	});
});
