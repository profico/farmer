import { describe, expect, spyOn, test } from "bun:test";

import { PostHog } from "posthog-node";

import { captureFailure, SLOW_SERVER_FN_MS } from "./capture-failure";
import * as posthogServer from "./posthog-server";

const run = (error: Error) =>
	captureFailure(
		{
			next: () => Promise.reject(error),
			serverFnMeta: { name: "fn", filename: "file.ts" },
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
	/** Run a call that takes `ms` on a fake clock. Resolves with the events
	 *  that PostHog got, after the background report had time to run. */
	const eventsFor = async (ms: number, fails = false) => {
		const client = new PostHog("test-token", { disabled: true });
		const capture = spyOn(client, "capture").mockImplementation(() => {});
		const getClient = spyOn(posthogServer, "getPostHogClient").mockReturnValue(
			client,
		);
		let clock = 0;
		try {
			await captureFailure(
				{
					next: () => {
						clock += ms;
						return fails ? Promise.reject(new Error("x")) : Promise.resolve(1);
					},
					serverFnMeta: { name: "fn", filename: "file.ts" },
				},
				() => new Headers(),
				() => clock,
			).catch(() => {});
			// The report is a background task, so give it time to finish.
			await Bun.sleep(300);
			return capture.mock.calls.map(([message]) => message);
		} finally {
			getClient.mockRestore();
		}
	};

	test("a fast call sends nothing", async () => {
		expect(await eventsFor(SLOW_SERVER_FN_MS - 1)).toEqual([]);
	});

	test("a slow call sends one event", async () => {
		const events = await eventsFor(SLOW_SERVER_FN_MS);
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			event: "server_fn_slow",
			properties: { server_fn_name: "fn", duration_ms: 1000, threw: false },
		});
	});

	test("a slow call that throws is reported as one that threw", async () => {
		const events = await eventsFor(SLOW_SERVER_FN_MS, true);
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({ properties: { threw: true } });
	});
});
