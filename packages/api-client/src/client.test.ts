import { describe, expect, test } from "bun:test";

import { FarmerClient } from "./client";
import { ApiClientError } from "./errors";
import { assertUsable, fetchMeta, REQUIRED_API_VERSION } from "./meta";
import { ORIGIN, jsonReply, scriptedServer } from "./test-server";

const me = {
	user: { id: "u1", name: "Ana", email: "ana@example.com" },
	organizations: [{ slug: "acme", name: "Acme" }],
};

const failureOf = async (promise: Promise<object | void>) => {
	try {
		await promise;
	} catch (error) {
		if (error instanceof ApiClientError) return error;
		throw error;
	}
	throw new Error("The call did not fail.");
};

describe("FarmerClient", () => {
	test("sends the bearer token and parses the answer", async () => {
		const { transport, requests } = scriptedServer([
			jsonReply(200, { ...me, extra: "dropped" }),
		]);
		const answer = await new FarmerClient(transport, "tok").me();
		expect(answer).toEqual(me);
		expect(requests[0]?.url).toBe(`${ORIGIN}/api/v1/me`);
		expect(requests[0]?.headers.get("authorization")).toBe("Bearer tok");
		expect(requests[0]?.headers.get("x-farmer-cli-version")).toBeNull();
	});

	test("a dead token is unauthorized", async () => {
		const { transport } = scriptedServer([
			jsonReply(401, { error: "Not signed in.", code: "unauthorized" }),
		]);
		const error = await failureOf(new FarmerClient(transport, "tok").me());
		expect(error.kind).toBe("unauthorized");
	});

	test("a 401 on a workspace is no_access while /me still works", async () => {
		const { transport, requests } = scriptedServer([
			jsonReply(401, { error: "Not signed in.", code: "unauthorized" }),
			jsonReply(200, me),
		]);
		const error = await failureOf(
			new FarmerClient(transport, "tok").whoami("gone"),
		);
		expect(error.kind).toBe("no_access");
		expect(requests[1]?.url).toBe(`${ORIGIN}/api/v1/me`);
	});

	test("a refusal carries the server's sentence and issues", async () => {
		const { transport } = scriptedServer([
			jsonReply(422, {
				error: "The input is not valid.",
				code: "invalid_input",
				issues: [{ path: "durationSeconds", message: "Enter some time" }],
			}),
		]);
		const error = await failureOf(
			new FarmerClient(transport, "tok").createTimeEntry("acme", {
				date: "2026-10-06",
				taskId: "t1",
			}),
		);
		expect(error.kind).toBe("http");
		expect(error.code).toBe("invalid_input");
		expect(error.message).toContain("Enter some time");
	});

	test("an answer that does not parse is invalid_response", async () => {
		const { transport } = scriptedServer([jsonReply(200, { timer: 4 })]);
		const error = await failureOf(
			new FarmerClient(transport, "tok").timer("acme"),
		);
		expect(error.kind).toBe("invalid_response");
	});

	test("sign out treats a dead token as signed out", async () => {
		const { transport, requests } = scriptedServer([
			jsonReply(401, { error: "Not signed in.", code: "unauthorized" }),
		]);
		await new FarmerClient(transport, "tok").signOut();
		expect(requests[0]?.method).toBe("DELETE");
	});

	test("a short 429 is waited out and retried", async () => {
		const { transport, requests } = scriptedServer([
			new Response(null, { status: 429, headers: { "retry-after": "1" } }),
			jsonReply(200, me),
		]);
		await new FarmerClient(transport, "tok").me();
		expect(requests).toHaveLength(2);
	});
});

const META = {
	app: "farmer" as const,
	cliEnabled: true,
	minCliVersion: "0.1.0",
	apiVersion: 1,
	serverVersion: null,
	minMobileVersion: "0.1.0",
	signInMethods: [],
	passwordSignIn: false,
	pushRelay: { enabled: false, url: null },
	uploadsEnabled: false,
	organizationCreation: true,
};

describe("fetchMeta", () => {
	test("the sign-in methods are read", async () => {
		const { transport } = scriptedServer([
			jsonReply(200, {
				...META,
				signInMethods: [
					{ id: "google", name: "Google", kind: "social" },
					{ id: "acme-sso", name: "Acme SSO", kind: "oidc" },
				],
				passwordSignIn: true,
			}),
		]);
		const meta = await fetchMeta(transport);
		expect(meta.signInMethods.map((method) => method.id)).toEqual([
			"google",
			"acme-sso",
		]);
		expect(meta.passwordSignIn).toBe(true);
	});

	test("an address that is not a Farmer server is refused", async () => {
		const { transport } = scriptedServer([jsonReply(200, { app: "other" })]);
		const error = await failureOf(fetchMeta(transport));
		expect(error.kind).toBe("not_farmer");
	});

	test("a server that needs a newer app refuses this one", () => {
		const meta = { ...META, minMobileVersion: "0.2.0" };
		expect(() => assertUsable(meta, ORIGIN, "0.1.9")).toThrow("Update the app");
		expect(() => assertUsable(meta, ORIGIN, "0.2.0")).not.toThrow(
			ApiClientError,
		);
	});

	test("a reply of a server before the contract parses and is refused", async () => {
		const { transport } = scriptedServer([
			jsonReply(200, {
				app: "farmer",
				cliEnabled: true,
				minCliVersion: "0.1.0",
			}),
		]);
		const meta = await fetchMeta(transport);
		expect(meta.apiVersion).toBe(0);
		expect(meta.signInMethods).toEqual([]);
		expect(() => assertUsable(meta, ORIGIN, "0.1.0")).toThrow(
			"Ask the administrator to update the server",
		);
	});

	test("a server at the required version is usable", async () => {
		const { transport } = scriptedServer([
			jsonReply(200, { ...META, apiVersion: REQUIRED_API_VERSION }),
		]);
		const meta = await fetchMeta(transport);
		expect(() => assertUsable(meta, ORIGIN, "0.1.0")).not.toThrow();
	});

	test("a server with the API off is refused", () => {
		const meta = { ...META, cliEnabled: false };
		expect(() => assertUsable(meta, ORIGIN, "0.1.0")).toThrow("switched off");
	});
});
