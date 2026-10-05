import type { Transport } from "@farmer/api-client";
import { fetch as expoFetch } from "expo/fetch";

import { USER_AGENT } from "../config";

export const transportFor = (origin: string): Transport => ({
	origin,
	fetch: (url, init) => fetch(url, init),
	// React Native's own `fetch` gives no body until the answer is complete.
	// `expo/fetch` gives a `ReadableStream` that fills as the bytes arrive, so
	// an assistant answer shows word by word.
	streamFetch: (url, init) => expoFetch(url, init),
	sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
	userAgent: USER_AGENT,
});
