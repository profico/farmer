import { describe, expect, spyOn, test } from "bun:test";

import { PostHog } from "posthog-node";

import { captureFailure, SLOW_SERVER_FN_MS } from "./capture-failure";
import * as posthogServer from "./posthog-server";

const META = { id: "abc", name: "fn", filename: "file.ts" };

const run = (error: Error) =>
	captureFailure(
		{
			next: () => Promise.reject(error),
			serverFnMeta: META,
		},
		// No request here: the capture fails, and the error must still come out.
		() => {
			throw new Error("no request");
		},
	);

describe("captureFailure", () => {
	test("rethrows the same fault object", async () => {
		const error = new TypeError("x is undefined");
		expect(await run(error).catch((e) => e)).toBe(error);
	});

	test("rethrows the same refusal object", async () => {
		const { AccessError } = await import("@farmer/core/services");
		const error = new AccessError("No.");
		expect(await run(error).catch((e) => e)).toBe(error);
	});
});

describe("slow server functions", () => {
	const client = new PostHog("test-token", { disabled: true });
	const capture = spyOn(client, "capture").mockImplementation(() => {});

	/** Run a call that takes `ms` on a fake clock, with the request `headers`. */
	const call = async (ms: number, headers: Headers, fails = false) => {
		let clock = 0;
		const now = spyOn(performance, "now").mockImplementation(() => clock);
		try {
			await captureFailure(
				{
					next: () => {
						clock += ms;
						return fails ? Promise.reject(new Error("x")) : Promise.resolve(1);
					},
					serverFnMeta: META,
				},
				() => headers,
			).catch(() => {});
		} finally {
			now.mockRestore();
		}
	};

	const events = () => capture.mock.calls.map(([message]) => message);

	/** The report is a background task: wait until PostHog got an event of
	 *  this duration. Reports run in call order, so earlier ones are in. */
	const waitForEventOf = async (durationMs: number) => {
		const deadline = Date.now() + 5000;
		while (
			!events().some((e) => e.properties?.duration_ms === durationMs) &&
			Date.now() < deadline
		) {
			await Bun.sleep(5);
		}
		return events();
	};

	const withClient = async (run: () => Promise<void>) => {
		capture.mockClear();
		const getClient = spyOn(posthogServer, "getPostHogClient").mockReturnValue(
			client,
		);
		try {
			await run();
		} finally {
			getClient.mockRestore();
		}
	};

	test("a fast call sends nothing and a slow call sends one event", () =>
		withClient(async () => {
			await call(SLOW_SERVER_FN_MS - 1, new Headers());
			await call(SLOW_SERVER_FN_MS, new Headers());
			const sent = await waitForEventOf(SLOW_SERVER_FN_MS);
			expect(sent).toHaveLength(1);
			expect(sent[0]).toMatchObject({
				event: "server_fn_slow",
				properties: {
					server_fn_id: "abc",
					server_fn_name: "fn",
					duration_ms: SLOW_SERVER_FN_MS,
					threw: false,
				},
			});
		}));

	test("a slow call that throws is reported as one that threw", () =>
		withClient(async () => {
			await call(SLOW_SERVER_FN_MS, new Headers(), true);
			const sent = await waitForEventOf(SLOW_SERVER_FN_MS);
			expect(sent).toMatchObject([{ properties: { threw: true } }]);
		}));

	test("two slow calls of one request send one event", () =>
		withClient(async () => {
			const headers = new Headers();
			await call(SLOW_SERVER_FN_MS, headers);
			await call(SLOW_SERVER_FN_MS, headers);
			// Another request gets its own event.
			await call(2 * SLOW_SERVER_FN_MS, new Headers());
			expect(await waitForEventOf(2 * SLOW_SERVER_FN_MS)).toHaveLength(2);
		}));
});
