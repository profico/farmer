// The Infrastructure pages' service: what a write stores, what a read gives
// back to a browser, and the one write that asks for a confirmation (a storage
// move while icons and logos point into the current store).

import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	test,
} from "bun:test";

import { eq } from "drizzle-orm";

import { db } from "../db";
import { organization, user } from "../db/schema/auth";
import { client, project } from "../db/schema/domain";
import { instanceSetting } from "../db/schema/instance";
import {
	INSTANCE_SETTINGS,
	replaceSettingsSnapshot,
	setInstanceSettingsForTests,
	setting,
} from "../lib/instance-settings";
import { type ObjectStore, setObjectStoreForTests } from "../lib/storage";
import { uploadKey, uploadPath } from "../lib/uploads";
import { createTestDb, present, type TestDb } from "../test/harness";
import {
	instanceSettingsService,
	StorageMoveNeedsConfirmationError,
} from "./instance-settings.service";

const ADMIN = "u-instance-admin";
const ORG = "org-instance";

let harness: TestDb;

// Bun loads the developer's `.env` into the suite, and a variable locks its
// name. Every name is cleared for this file and put back after it.
const saved = new Map(
	INSTANCE_SETTINGS.map(({ name }) => [name, process.env[name]]),
);
for (const name of saved.keys()) delete process.env[name];

const storedRow = async (name: string) =>
	(
		await db
			.select()
			.from(instanceSetting)
			.where(eq(instanceSetting.name, name))
	)[0] ?? null;

const viewOf = async (name: string) =>
	present(
		(await instanceSettingsService.view()).find((row) => row.name === name),
		name,
	);

beforeAll(async () => {
	harness = await createTestDb();
	await db.insert(user).values({
		id: ADMIN,
		name: "Admin",
		email: "admin@example.com",
		emailVerified: true,
		createdAt: new Date(),
		updatedAt: new Date(),
	});
	await db.insert(organization).values({
		id: ORG,
		name: ORG,
		slug: ORG,
		createdAt: new Date(),
	});
});

afterEach(() => {
	setInstanceSettingsForTests(undefined);
	setObjectStoreForTests(undefined);
});

afterAll(async () => {
	// The snapshot is module state and outlives this file's database.
	replaceSettingsSnapshot(new Map());
	for (const [name, value] of saved) {
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
	await harness.close();
});

describe("update", () => {
	test("seals a secret in its row and opens it for the readers", async () => {
		await instanceSettingsService.update(ADMIN, {
			SMTP_PASS: "hunter2-password",
		});
		const row = present(await storedRow("SMTP_PASS"), "SMTP_PASS row");
		expect(row.value.startsWith("enc:")).toBe(true);
		expect(row.value).not.toContain("hunter2");
		expect(row.updatedBy).toBe(ADMIN);
		expect(setting("SMTP_PASS")).toBe("hunter2-password");
	});

	test("stores a plain value as it is", async () => {
		await instanceSettingsService.update(ADMIN, { SMTP_HOST: "smtp.example" });
		expect(present(await storedRow("SMTP_HOST"), "row").value).toBe(
			"smtp.example",
		);
		expect(setting("SMTP_HOST")).toBe("smtp.example");
	});

	test("null deletes the row, so the default answers again", async () => {
		await instanceSettingsService.update(ADMIN, { SMTP_PORT: "587" });
		expect(setting("SMTP_PORT")).toBe("587");
		await instanceSettingsService.update(ADMIN, { SMTP_PORT: null });
		expect(await storedRow("SMTP_PORT")).toBeNull();
		expect(setting("SMTP_PORT")).toBe("465");
	});

	test("refuses a name it does not know, and writes nothing", async () => {
		await expect(
			instanceSettingsService.update(ADMIN, {
				SMTP_USER: "someone",
				DATABASE_URL: "postgres://elsewhere",
			}),
		).rejects.toThrow(/no setting called DATABASE_URL/);
		expect(await storedRow("SMTP_USER")).toBeNull();
		expect(await storedRow("DATABASE_URL")).toBeNull();
	});

	test("refuses a name the environment sets", async () => {
		process.env.S3_REGION = "eu-west-1";
		try {
			await expect(
				instanceSettingsService.update(ADMIN, { S3_REGION: "garage" }),
			).rejects.toThrow(/set by the environment/);
			expect(await storedRow("S3_REGION")).toBeNull();
		} finally {
			delete process.env.S3_REGION;
		}
	});

	test("refuses a value a select or a switch cannot hold", async () => {
		await expect(
			instanceSettingsService.update(ADMIN, { EMAIL_PROVIDER: "carrier" }),
		).rejects.toThrow(/cannot be "carrier"/);
		await expect(
			instanceSettingsService.update(ADMIN, { MCP_ENABLED: "yes" }),
		).rejects.toThrow(/true or false/);
	});
});

describe("view", () => {
	test("never carries a secret, only its first characters", async () => {
		await instanceSettingsService.update(ADMIN, {
			SMTP_PASS: "hunter2-password",
		});
		const row = await viewOf("SMTP_PASS");
		expect(row.value).toBeNull();
		expect(row.secretHint).toBe("hunt••••••••");
		expect(row.source).toBe("db");
		expect(JSON.stringify(await instanceSettingsService.view())).not.toContain(
			"hunter2-password",
		);
	});

	test("says which values the environment locks", async () => {
		process.env.S3_REGION = "eu-west-1";
		try {
			expect(await viewOf("S3_REGION")).toMatchObject({
				source: "env",
				locked: true,
				value: "eu-west-1",
			});
		} finally {
			delete process.env.S3_REGION;
		}
		expect(await viewOf("S3_REGION")).toMatchObject({
			source: "default",
			locked: false,
			value: "us-east-1",
		});
	});
});

describe("the storage move guard", () => {
	const ICON = uploadKey(ORG, "project-icon", crypto.randomUUID(), "png");

	beforeAll(async () => {
		await instanceSettingsService.update(ADMIN, {
			S3_ENDPOINT: "http://localhost:3900",
			S3_BUCKET: "farmer",
			S3_ACCESS_KEY_ID: "GK-test",
			S3_SECRET_ACCESS_KEY: "secret-test",
		});
	});

	test("lets a store move while nothing is stored", async () => {
		expect(await instanceSettingsService.storageUsage()).toEqual({
			storedObjects: 0,
		});
		await instanceSettingsService.update(ADMIN, { S3_BUCKET: "farmer-2" });
		await instanceSettingsService.update(ADMIN, { S3_BUCKET: "farmer" });
		expect(setting("S3_BUCKET")).toBe("farmer");
	});

	test("counts each stored file once, however many rows wear it", async () => {
		await db
			.update(organization)
			.set({
				logo: uploadPath(
					uploadKey(ORG, "org-logo", crypto.randomUUID(), "svg"),
				),
			})
			.where(eq(organization.id, ORG));
		const [acme] = await db
			.insert(client)
			.values({ organizationId: ORG, name: "Acme" })
			.returning();
		const clientId = present(acme, "client").id;
		await db.insert(project).values([
			{ organizationId: ORG, clientId, name: "One", icon: uploadPath(ICON) },
			{ organizationId: ORG, clientId, name: "Two", icon: uploadPath(ICON) },
			{ organizationId: ORG, clientId, name: "Emoji", icon: "🚜" },
		]);
		expect(await instanceSettingsService.storageUsage()).toEqual({
			storedObjects: 2,
		});
	});

	test("refuses a new endpoint or bucket until it is confirmed", async () => {
		const moves: Record<string, string | null>[] = [
			{ S3_BUCKET: "farmer-2" },
			{ S3_ENDPOINT: "https://s3.example.com" },
			{ S3_ENDPOINT: null },
		];
		for (const changes of moves) {
			const refusal = instanceSettingsService.update(ADMIN, changes);
			await expect(refusal).rejects.toBeInstanceOf(
				StorageMoveNeedsConfirmationError,
			);
			await expect(refusal).rejects.toThrow(/2 stored files point/);
		}
		expect(setting("S3_BUCKET")).toBe("farmer");
		expect(setting("S3_ENDPOINT")).toBe("http://localhost:3900");

		await instanceSettingsService.update(
			ADMIN,
			{ S3_BUCKET: "farmer-2" },
			{ confirmStorageMove: true },
		);
		expect(setting("S3_BUCKET")).toBe("farmer-2");
	});

	test("does not ask when the location stays where it is", async () => {
		await instanceSettingsService.update(ADMIN, {
			S3_BUCKET: " farmer-2 ",
			S3_REGION: "garage",
			S3_SECRET_ACCESS_KEY: "rotated-secret",
		});
		expect(setting("S3_REGION")).toBe("garage");
	});
});

describe("testStorage", () => {
	const memoryStore = (): ObjectStore & { keys: Map<string, Uint8Array> } => {
		const keys = new Map<string, Uint8Array<ArrayBuffer>>();
		return {
			keys,
			put: async (key, bytes) => {
				keys.set(key, bytes);
			},
			get: async (key) => {
				const bytes = keys.get(key);
				if (!bytes) return null;
				return {
					body: present(new Response(bytes).body, "body"),
					size: bytes.byteLength,
				};
			},
			list: async function* () {},
			delete: async (key) => {
				keys.delete(key);
			},
		};
	};

	test("fails with a reason when no store is configured", async () => {
		setObjectStoreForTests(null);
		const result = await instanceSettingsService.testStorage();
		expect(result.ok).toBe(false);
		expect(result.message).toMatch(/no store is configured/i);
	});

	test("writes, reads and deletes a probe outside the swept prefix", async () => {
		const store = memoryStore();
		const written: string[] = [];
		setObjectStoreForTests({
			...store,
			put: async (key, bytes, type) => {
				written.push(key);
				await store.put(key, bytes, type);
			},
		});
		expect(await instanceSettingsService.testStorage()).toEqual({
			ok: true,
			message: "Wrote, read and deleted a test file.",
		});
		expect(written).toHaveLength(1);
		expect(present(written[0], "probe key").startsWith("orgs/")).toBe(false);
		expect(store.keys.size).toBe(0);
	});

	test("reports a refusal without throwing, and without the secret", async () => {
		setInstanceSettingsForTests({ S3_SECRET_ACCESS_KEY: "very-secret-key" });
		setObjectStoreForTests({
			...memoryStore(),
			put: async () => {
				throw new Error("signature mismatch for very-secret-key");
			},
		});
		const result = await instanceSettingsService.testStorage();
		expect(result.ok).toBe(false);
		expect(result.message).toContain("The write failed");
		expect(result.message).not.toContain("very-secret-key");
	});

	test("cleans up the probe when the read fails", async () => {
		const store = memoryStore();
		setObjectStoreForTests({
			...store,
			get: async () => {
				throw new Error("read refused");
			},
		});
		const result = await instanceSettingsService.testStorage();
		expect(result).toEqual({
			ok: false,
			message: "The read failed: read refused",
		});
		expect(store.keys.size).toBe(0);
	});
});

describe("testEmail", () => {
	test("fails with a reason when no provider is configured", async () => {
		setInstanceSettingsForTests({});
		const result = await instanceSettingsService.testEmail("a@example.com");
		expect(result.ok).toBe(false);
		expect(result.message).toMatch(/no email provider configured/i);
	});
});
