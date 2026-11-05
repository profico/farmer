import type { Transport } from "./transport";

export const ORIGIN = "https://farmer.test";

export type RecordedRequest = {
	url: string;
	method: string;
	headers: Headers;
	body: string | null;
};

/** A JSON value, as a fake server answers one. */
export type JsonBody =
	| string
	| number
	| boolean
	| null
	| JsonBody[]
	| { [key: string]: JsonBody };

export const jsonReply = (status: number, body: JsonBody) =>
	new Response(body === null ? null : JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});

/** A fake server that answers each request with the next reply in order, and
 *  records what it was sent. */
export const scriptedServer = (replies: Response[]) => {
	const requests: RecordedRequest[] = [];
	const queue = [...replies];
	const transport: Transport = {
		origin: ORIGIN,
		userAgent: "farmer-mobile/0.1.0 (test)",
		sleep: async () => undefined,
		fetch: async (url, init) => {
			requests.push({
				url,
				method: init.method ?? "GET",
				headers: new Headers(init.headers),
				body:
					init.body === undefined || init.body === null
						? null
						: String(init.body),
			});
			const reply = queue.shift();
			if (!reply) throw new Error(`No reply scripted for ${url}`);
			return reply;
		},
	};
	return { transport, requests };
};
