import type { Transport } from "@farmer/api-client";

import { USER_AGENT } from "../config";

export const transportFor = (origin: string): Transport => ({
	origin,
	fetch: (url, init) => fetch(url, init),
	sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
	userAgent: USER_AGENT,
});
