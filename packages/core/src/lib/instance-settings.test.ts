// The resolver and the synchronous readers built on it. The order (the
// environment, then the stored value, then the default) is ADR 0004; each
// reader here used to go to `process.env` itself, so each is pinned on reading
// the stored half too.

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import crypto from "node:crypto";

import { isAssistantEnabled } from "./assistant-flag";
import { isCliEnabled } from "./cli-flag";
import { emailProvider } from "./email";
import { appPrivateKeyPem, isGithubAppConfigured } from "./github-client";
import {
	resolveSetting,
	type SettingName,
	setInstanceSettingsForTests,
	setting,
} from "./instance-settings";
import { isMcpEnabled } from "./mcp-flag";
import { isSingleOrgMode, singleOrgSlug } from "./single-org";
import { objectStore, setObjectStoreForTests } from "./storage";

/** Every name a test here touches. The developer's `.env` sets some of them
 *  (Bun loads it into the suite), and a set variable locks the name. */
const TOUCHED: SettingName[] = [
	"S3_REGION",
	"S3_ENDPOINT",
	"S3_BUCKET",
	"S3_ACCESS_KEY_ID",
	"S3_SECRET_ACCESS_KEY",
	"ASSISTANT_ENABLED",
	"MCP_ENABLED",
	"CLI_ENABLED",
	"SINGLE_ORG_SLUG",
	"EMAIL_PROVIDER",
	"RESEND_API_KEY",
	"SMTP_HOST",
	"SMTP_PORT",
	"SMTP_USER",
	"SMTP_PASS",
	"GITHUB_APP_ID",
	"GITHUB_APP_PRIVATE_KEY",
];
const saved = new Map(TOUCHED.map((name) => [name, process.env[name]]));

afterEach(() => {
	setInstanceSettingsForTests(undefined);
	for (const name of TOUCHED) delete process.env[name];
});

afterAll(() => {
	// Assigning `undefined` would store the string "undefined".
	for (const [name, value] of saved) {
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
});

for (const name of TOUCHED) delete process.env[name];

describe("resolveSetting", () => {
	test("the default answers when nothing else does", () => {
		expect(resolveSetting("S3_REGION")).toEqual({
			value: "us-east-1",
			source: "default",
			locked: false,
			lockedBy: null,
		});
		expect(resolveSetting("S3_BUCKET")).toEqual({
			value: undefined,
			source: "default",
			locked: false,
			lockedBy: null,
		});
	});

	test("a stored value beats the default", () => {
		setInstanceSettingsForTests({ S3_REGION: "garage" });
		expect(resolveSetting("S3_REGION")).toEqual({
			value: "garage",
			source: "db",
			locked: false,
			lockedBy: null,
		});
	});

	test("the environment beats a stored value, and locks the name", () => {
		setInstanceSettingsForTests({ S3_REGION: "garage" });
		process.env.S3_REGION = "eu-west-1";
		expect(resolveSetting("S3_REGION")).toEqual({
			value: "eu-west-1",
			source: "env",
			locked: true,
			lockedBy: null,
		});
	});

	// `.env.example` lists names with nothing after the `=`. A copied file must
	// not lock every field, or hide the stored value behind an empty one.
	test("an empty or blank variable is not set", () => {
		setInstanceSettingsForTests({ S3_REGION: "garage" });
		for (const blank of ["", "   "]) {
			process.env.S3_REGION = blank;
			expect(resolveSetting("S3_REGION")).toEqual({
				value: "garage",
				source: "db",
				locked: false,
				lockedBy: null,
			});
		}
	});
});

describe("lock groups", () => {
	// A pinned SMTP password with an open host would let a platform admin
	// send that password to a server of their own.
	test("a variable locks every setting in its group, and names itself", () => {
		setInstanceSettingsForTests({ SMTP_HOST: "mail.example.com" });
		process.env.SMTP_PASS = "pinned";
		expect(resolveSetting("SMTP_HOST")).toEqual({
			value: "mail.example.com",
			source: "db",
			locked: true,
			lockedBy: "SMTP_PASS",
		});
		expect(resolveSetting("SMTP_PORT")).toMatchObject({
			source: "default",
			locked: true,
			lockedBy: "SMTP_PASS",
		});
	});

	test("does not reach a setting outside the group", () => {
		process.env.SMTP_PASS = "pinned";
		expect(resolveSetting("S3_BUCKET").locked).toBe(false);
		expect(resolveSetting("RESEND_API_KEY").locked).toBe(false);
	});
});

describe("the feature flags", () => {
	const flags = [
		["ASSISTANT_ENABLED", isAssistantEnabled],
		["MCP_ENABLED", isMcpEnabled],
		["CLI_ENABLED", isCliEnabled],
	] as const;

	test("are on when nothing sets them", () => {
		for (const [, enabled] of flags) expect(enabled()).toBe(true);
	});

	test("read the stored value", () => {
		for (const [name, enabled] of flags) {
			setInstanceSettingsForTests({ [name]: "false" });
			expect(enabled()).toBe(false);
		}
	});

	test("follow the environment over the stored value", () => {
		for (const [name, enabled] of flags) {
			setInstanceSettingsForTests({ [name]: "false" });
			process.env[name] = "true";
			expect(enabled()).toBe(true);
		}
	});
});

describe("objectStore", () => {
	const S3 = {
		S3_ENDPOINT: "http://localhost:3900",
		S3_BUCKET: "farmer",
		S3_ACCESS_KEY_ID: "GK-test",
		S3_SECRET_ACCESS_KEY: "secret-test",
	};

	afterEach(() => {
		setObjectStoreForTests(undefined);
	});

	test("is built from the stored settings", () => {
		expect(objectStore()).toBeNull();
		setInstanceSettingsForTests(S3);
		expect(objectStore()).not.toBeNull();
	});

	test("is null while any of the four is missing", () => {
		for (const missing of Object.keys(S3)) {
			setInstanceSettingsForTests(
				Object.fromEntries(
					Object.entries(S3).filter(([name]) => name !== missing),
				),
			);
			expect(objectStore()).toBeNull();
		}
	});

	test("the test seam: null is no store, undefined is the settings again", () => {
		setInstanceSettingsForTests(S3);
		setObjectStoreForTests(null);
		expect(objectStore()).toBeNull();
		setObjectStoreForTests(undefined);
		expect(objectStore()).not.toBeNull();
	});
});

describe("the other readers", () => {
	test("single-organization mode follows the setting per call", () => {
		expect(isSingleOrgMode()).toBe(false);
		setInstanceSettingsForTests({ SINGLE_ORG_SLUG: " acme " });
		expect(singleOrgSlug()).toBe("acme");
		expect(isSingleOrgMode()).toBe(true);
	});

	test("the mail provider follows the stored keys", () => {
		expect(emailProvider()).toBeNull();
		setInstanceSettingsForTests({ SMTP_HOST: "smtp.example.com" });
		expect(emailProvider()).toBe("smtp");
		setInstanceSettingsForTests({
			SMTP_HOST: "smtp.example.com",
			RESEND_API_KEY: "re_test",
		});
		expect(emailProvider()).toBe("resend");
	});

	test("the GitHub App counts as configured from stored values", () => {
		expect(isGithubAppConfigured()).toBe(false);
		setInstanceSettingsForTests({
			GITHUB_APP_ID: "1",
			GITHUB_APP_PRIVATE_KEY: "key",
		});
		expect(isGithubAppConfigured()).toBe(true);
		expect(setting("GITHUB_APP_ID")).toBe("1");
	});
});

// The page takes the PEM as pasted; the environment has held its base64 since
// before the page existed. Both must sign.
describe("appPrivateKeyPem", () => {
	const { privateKey } = crypto.generateKeyPairSync("rsa", {
		modulusLength: 1024,
		privateKeyEncoding: { type: "pkcs8", format: "pem" },
		publicKeyEncoding: { type: "spki", format: "pem" },
	});

	test("keeps a PEM as it is", () => {
		expect(appPrivateKeyPem(`\n${privateKey}\n`)).toBe(privateKey.trim());
	});

	test("decodes a base64 PEM", () => {
		expect(appPrivateKeyPem(Buffer.from(privateKey).toString("base64"))).toBe(
			privateKey,
		);
	});
});
