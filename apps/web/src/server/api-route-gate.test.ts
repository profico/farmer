import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { AccessError } from "@farmer/core/services";

import { requireSignIn } from "./api-route.ts";

const ORG_ROUTES = join(import.meta.dir, "../routes/api/v1/orgs/$orgSlug");

describe("requireSignIn", () => {
	test("refuses an API token", async () => {
		await expect(requireSignIn("api_token")).rejects.toBeInstanceOf(
			AccessError,
		);
	});

	test("lets a sign-in session pass, as the mobile app and the CLI use", async () => {
		expect(await requireSignIn("session")).toBeUndefined();
	});

	test("lets a signed-in browser pass", async () => {
		expect(await requireSignIn("cookie")).toBeUndefined();
	});
});

/** Each `METHOD: apiRoute({` of a route file, with the text up to the next
 *  handler, so a check reads one handler and not the whole file. */
const handlersOf = (file: string) => {
	const source = readFileSync(join(ORG_ROUTES, file), "utf8");
	const heads = [
		...source.matchAll(/\b(GET|POST|PUT|PATCH|DELETE): apiRoute\(\{/g),
	];
	return heads.map((head, index) => ({
		method: head[1],
		body: source.slice(head.index, heads[index + 1]?.index ?? source.length),
	}));
};

const gated = (body: string) => /signInOnly: true/.test(body);

/** Routes that manage a credential, an integration, a webhook, a person or a
 *  setting of the workspace: every handler refuses an API token. */
const WHOLE_FILES = [
	"webhooks/index.ts",
	"webhooks/$id/index.ts",
	"webhooks/$id/deliveries.ts",
	"webhooks/$id/roll-secret.ts",
	"webhooks/$id/test.ts",
	"webhooks/deliveries/$id/resend.ts",
	"audit-log/index.ts",
	"audit-log/export.ts",
	"audit-log/retention.ts",
	"organization/policy.ts",
	"reminders/index.ts",
	"reminders/preview.ts",
	"people/index.ts",
	"people/$userId/index.ts",
	"people/$userId/archive.ts",
	"people/$userId/restore.ts",
	"people/$userId/confirm-email.ts",
	"people/$userId/role.ts",
	"people/$userId/start-date.ts",
	"people/$userId/team.ts",
	"people/$userId/type.ts",
	"invitations/index.ts",
	"invitations/$id/index.ts",
	"invitations/$id/resend.ts",
	"workspace-integrations/github/index.ts",
	"workspace-integrations/github/install-url.ts",
	"workspace-integrations/github/installations/$id.ts",
	"workspace-integrations/github/repositories/index.ts",
	"workspace-integrations/github/repositories/refresh.ts",
	"workspace-integrations/slack/index.ts",
	"workspace-integrations/slack/install-url.ts",
	"workspace-integrations/slack/match-people.ts",
	"workspace-integrations/slack/test.ts",
];

/** Files where only the writes refuse a token. The read stays open to a
 *  member, as in the web app. */
const WRITES_ONLY = {
	"assistant/settings.ts": ["POST", "PATCH", "DELETE"],
	"organization.ts": ["PATCH"],
	"integrations/settings.ts": ["PATCH"],
	"integrations/github.ts": ["DELETE"],
	"integrations/google-calendar.ts": ["DELETE"],
};

describe("admin routes refuse an API token", () => {
	for (const file of WHOLE_FILES) {
		test(file, () => {
			const handlers = handlersOf(file);
			expect(handlers.length).toBeGreaterThan(0);
			for (const handler of handlers) {
				expect(`${handler.method} ${gated(handler.body)}`).toBe(
					`${handler.method} true`,
				);
			}
		});
	}

	for (const [file, methods] of Object.entries(WRITES_ONLY)) {
		test(`${file}: ${methods.join(", ")}`, () => {
			const handlers = handlersOf(file);
			for (const method of methods) {
				const handler = handlers.find((entry) => entry.method === method);
				expect(`${method} ${handler ? gated(handler.body) : "missing"}`).toBe(
					`${method} true`,
				);
			}
		});
	}
});
