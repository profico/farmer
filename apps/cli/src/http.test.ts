import { describe, expect, test } from "bun:test";

import { createCredentialStore, type Keyring } from "./credentials";
import { CliError } from "./errors";
import { ApiClient, normalizeOrigin, retryAfterSeconds } from "./http";
import { jsonReply, scriptedServer } from "./test-server";

const ORIGIN = "https://farmer.test";

const memoryKeyring = (): Keyring => {
	const tokens = new Map<string, string>();
	return {
		get: async (origin) => tokens.get(origin) ?? null,
		set: async (origin, token) => {
			tokens.set(origin, token);
		},
		delete: async (origin) => {
			tokens.delete(origin);
		},
	};
};

const clientWith = async (replies: Response[]) => {
	const server = scriptedServer(replies);
	const store = createCredentialStore(
		memoryKeyring(),
		"/nonexistent/credentials.json",
	);
	await store.set(ORIGIN, "session-token");
	const api = new ApiClient({
		transport: server.transport,
		token: "session-token",
		forgetToken: () => store.delete(ORIGIN),
	});
	return { ...server, store, api };
};

const unauthorized = () =>
	jsonReply(401, { error: "Unauthorized", code: "unauthorized" });

describe("ApiClient", () => {
	test("sends the bearer token, the version header and the CLI user agent", async () => {
		const { api, requests } = await clientWith([jsonReply(200, { ok: true })]);
		await api.get("/api/v1/me");
		const [request] = requests;
		expect(request?.url).toBe(`${ORIGIN}/api/v1/me`);
		expect(request?.headers.get("authorization")).toBe("Bearer session-token");
		expect(request?.headers.get("x-farmer-cli-version")).toBe("0.1.0");
		expect(request?.headers.get("user-agent")).toBe(
			"farmer-cli/0.1.0 (linux; x64)",
		);
	});

	test("a 401 deletes the stored token and says to log in", async () => {
		const { api, store } = await clientWith([unauthorized()]);
		await expect(api.get("/api/v1/me")).rejects.toThrow("farmer login");
		expect(await store.get(ORIGIN)).toBeNull();
	});

	test("a 401 from an org route keeps the token when /me still accepts it", async () => {
		const { api, store, requests } = await clientWith([
			unauthorized(),
			jsonReply(200, { user: {}, organizations: [] }),
		]);
		await expect(api.get("/api/v1/orgs/acme/whoami")).rejects.toThrow(
			'no access to the organization "acme"',
		);
		expect(requests.map((request) => request.url)).toEqual([
			`${ORIGIN}/api/v1/orgs/acme/whoami`,
			`${ORIGIN}/api/v1/me`,
		]);
		expect(await store.get(ORIGIN)).toBe("session-token");
	});

	test("a 401 from an org route deletes the token when /me refuses it too", async () => {
		const { api, store } = await clientWith([unauthorized(), unauthorized()]);
		await expect(api.get("/api/v1/orgs/acme/whoami")).rejects.toThrow(
			"farmer login",
		);
		expect(await store.get(ORIGIN)).toBeNull();
	});

	test("a 426 tells the person to re-run the install command", async () => {
		const { api } = await clientWith([
			jsonReply(426, { error: "Update", code: "cli_outdated" }),
		]);
		await expect(api.get("/api/v1/me")).rejects.toThrow(
			`curl -fsSL ${ORIGIN}/cli | sh`,
		);
	});

	test("the 426 command on Windows is the PowerShell one", async () => {
		const server = scriptedServer([
			jsonReply(426, { error: "Update", code: "cli_outdated" }),
		]);
		const api = new ApiClient({
			transport: { ...server.transport, platform: "win32" },
			token: "t",
			forgetToken: async () => undefined,
		});
		await expect(api.get("/api/v1/me")).rejects.toThrow(
			`irm ${ORIGIN}/cli | iex`,
		);
	});

	test("a 429 with a short Retry-After waits that long and retries", async () => {
		const { api, sleeps, requests } = await clientWith([
			jsonReply(429, { error: "Slow down", code: "rate_limited" }, [
				["retry-after", "7"],
			]),
			jsonReply(200, { id: "e1" }),
		]);
		expect(await api.get<{ id: string }>("/api/v1/me")).toEqual({ id: "e1" });
		expect(sleeps).toEqual([7000]);
		expect(requests).toHaveLength(2);
	});

	test("a 429 with a long Retry-After is reported, not waited out", async () => {
		const { api, sleeps } = await clientWith([
			jsonReply(429, { error: "Slow down", code: "rate_limited" }, [
				["retry-after", "120"],
			]),
		]);
		await expect(api.get("/api/v1/me")).rejects.toThrow(
			"Try again in 120 seconds",
		);
		expect(sleeps).toEqual([]);
	});

	test("a 422 shows the sentence and every issue", async () => {
		const { api } = await clientWith([
			jsonReply(422, {
				error: "The day would pass 24 hours.",
				code: "invalid_input",
				issues: [{ path: "durationSeconds", message: "Too long" }],
			}),
		]);
		await expect(
			api.post("/api/v1/orgs/acme/time-entries", {}),
		).rejects.toThrow(
			"The day would pass 24 hours.\n  durationSeconds: Too long",
		);
	});

	// A command for a route the server does not have has to tell that apart
	// from a route the server refuses. Both answer 404; only the refusal
	// carries a `code`, so the code is what the command branches on — see
	// `commands/timer.ts`.
	test("carries the status and the code of a failure", async () => {
		const { api } = await clientWith([
			jsonReply(404, { error: "Not found", code: "not_found" }),
		]);
		const refused = await api
			.get("/api/v1/orgs/acme/timer")
			.then(() => null)
			.catch((error: unknown) => error);
		if (!(refused instanceof CliError)) throw new Error("Expected a CliError");
		expect(refused.status).toBe(404);
		expect(refused.code).toBe("not_found");
	});

	test("carries no code when the body is not an ApiError", async () => {
		const { api } = await clientWith([
			new Response("<html>Not Found</html>", { status: 404 }),
		]);
		const missing = await api
			.get("/api/v1/orgs/acme/timer")
			.then(() => null)
			.catch((error: unknown) => error);
		if (!(missing instanceof CliError)) throw new Error("Expected a CliError");
		expect(missing.status).toBe(404);
		expect(missing.code).toBeUndefined();
	});
});

describe("retryAfterSeconds", () => {
	test("reads seconds and HTTP dates", () => {
		const now = Date.parse("2026-09-14T10:00:00Z");
		expect(retryAfterSeconds("30", now)).toBe(30);
		expect(retryAfterSeconds("Mon, 14 Sep 2026 10:00:45 GMT", now)).toBe(45);
		expect(retryAfterSeconds(null, now)).toBeNull();
		expect(retryAfterSeconds("soon", now)).toBeNull();
	});
});

describe("normalizeOrigin", () => {
	test("keeps the origin of what a person types", () => {
		expect(normalizeOrigin("farmer.example.com")).toBe(
			"https://farmer.example.com",
		);
		expect(normalizeOrigin("https://farmer.example.com/acme/time")).toBe(
			"https://farmer.example.com",
		);
		expect(normalizeOrigin("localhost:3000")).toBe("http://localhost:3000");
		expect(() => normalizeOrigin("ftp://farmer.example.com")).toThrow(
			"not an http or https address",
		);
	});
});
