/**
 * A scripted server for the client tests: `fetch` answers from a queue and
 * records every request, and `sleep` records the wait instead of waiting.
 * Injected through `Transport`, so no module is mocked.
 */

import type { Transport } from "./http";

export type RecordedRequest = {
	url: string;
	method: string;
	headers: Headers;
	body: string | null;
};

export const jsonReply = <T>(
	status: number,
	body: T,
	headers: [string, string][] = [],
) =>
	new Response(JSON.stringify(body), {
		status,
		headers: [["content-type", "application/json"], ...headers],
	});

export const scriptedServer = (replies: Response[]) => {
	const requests: RecordedRequest[] = [];
	const sleeps: number[] = [];
	const transport: Transport = {
		origin: "https://farmer.test",
		fetch: async (url, init) => {
			requests.push({
				url,
				method: init.method ?? "GET",
				headers: new Headers(init.headers),
				body: init.body ? String(init.body) : null,
			});
			const reply = replies.shift();
			if (!reply) throw new Error(`No reply scripted for ${url}`);
			return reply;
		},
		sleep: async (ms) => {
			sleeps.push(ms);
		},
		version: "0.1.0",
		platform: "linux",
		arch: "x64",
	};
	return { transport, requests, sleeps };
};
