import { describe, expect, test } from "bun:test";

import { DrizzleQueryError } from "drizzle-orm/errors";
import { z } from "zod";

import {
	GithubInstallationGoneError,
	GithubRateLimitError,
	GithubTokenInvalidError,
} from "../lib/github-client";
import { OpenRouterError } from "../lib/openrouter-client";
import { ObjectStoreError } from "../lib/storage";
import { UserFacingError } from "../lib/user-facing-error";
import { AccessError, NotAMemberError } from "./access.service";
import {
	AssistantDisabledError,
	AssistantError,
	AssistantNotConfiguredError,
} from "./assistant.service";
import { classifyServiceError, safeErrorMessage } from "./error-message";
import { CurrentSessionRevokeError } from "./sessions.service";
import { DayCapacityError } from "./time-entries.service";
import { UploadRejectedError } from "./uploads.service";
import { WebhookUrlRefusedError } from "./webhooks.service";

describe("what a client may be told about a service error", () => {
	test("a sentence a service threw on purpose passes", () => {
		expect(safeErrorMessage(new Error("Time entry not found"))).toBe(
			"Time entry not found",
		);
		expect(classifyServiceError(new Error("Time entry not found")).kind).toBe(
			"not_found",
		);
		expect(
			classifyServiceError(new Error("Only absence tasks can be logged")).kind,
		).toBe("refused");
		expect(safeErrorMessage(new AccessError("Admin access required"))).toBe(
			"Admin access required",
		);
	});

	test("a validation failure passes with its issues", () => {
		const parsed = z.object({ hours: z.number() }).safeParse({ hours: "x" });
		expect(parsed.success).toBe(false);
		if (parsed.success) return;
		const verdict = classifyServiceError(parsed.error);
		expect(verdict.kind).toBe("validation");
		expect(safeErrorMessage(parsed.error)).toContain("hours");
	});

	test("a full day passes", () => {
		const verdict = classifyServiceError(new DayCapacityError("2026-09-22"));
		expect(verdict.kind).toBe("capacity");
	});

	test("a database error is withheld, SQL and parameters included", () => {
		const error = new DrizzleQueryError(
			'select * from "user" where "email" = $1',
			["someone@example.com"],
			new Error('relation "user" does not exist'),
		);
		expect(classifyServiceError(error).kind).toBe("unsafe");
		expect(safeErrorMessage(error)).toBeNull();
	});

	test("a runtime error or a system error is withheld", () => {
		expect(safeErrorMessage(new TypeError("x is undefined"))).toBeNull();
		const system = Object.assign(new Error("connect ECONNREFUSED 10.0.0.5"), {
			code: "ECONNREFUSED",
		});
		expect(safeErrorMessage(system)).toBeNull();
	});

	test("every class that extends UserFacingError passes", () => {
		const facing: Error[] = [
			new GithubRateLimitError("https://api.github.com/repos/acme/secret"),
			new GithubTokenInvalidError("https://api.github.com/user"),
			new GithubInstallationGoneError(42),
			new UploadRejectedError("The image is larger than 1 MB."),
			new CurrentSessionRevokeError(),
			new AssistantNotConfiguredError(),
			new AssistantDisabledError(),
			new NotAMemberError("org-1"),
		];
		for (const error of facing) {
			expect(error).toBeInstanceOf(UserFacingError);
			expect(safeErrorMessage(error)).toBe(error.message);
		}
		expect(
			classifyServiceError(new AssistantError("Conversation not found")),
		).toEqual({ kind: "not_found", message: "Conversation not found" });
		expect(
			classifyServiceError(new UploadRejectedError("The file is empty.")),
		).toEqual({ kind: "refused", message: "The file is empty." });
		expect(classifyServiceError(new NotAMemberError("org-1")).kind).toBe(
			"forbidden",
		);
	});

	test("a GitHub error keeps its URL off the message a person reads", () => {
		const url = "https://api.github.com/repos/acme/secret/commits?author=x";
		for (const error of [
			new GithubRateLimitError(url),
			new GithubTokenInvalidError(url),
		]) {
			expect(error.url).toBe(url);
			expect(safeErrorMessage(error)).not.toContain("acme");
		}
	});

	test("a class that may carry detail stays withheld", () => {
		expect(
			safeErrorMessage(
				new WebhookUrlRefusedError(
					"internal.acme resolves to 10.0.0.5, which is not reachable",
				),
			),
		).toBeNull();
		expect(
			safeErrorMessage(new OpenRouterError("upstream said: <body>", 500)),
		).toBeNull();
		expect(safeErrorMessage(new ObjectStoreError("bucket x: 503"))).toBeNull();
	});
});
