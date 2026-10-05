// A push relay on localhost, for the tests of the native push channel.
//
// It answers `POST /v1/push` as `apps/push-relay` does, with a status that a
// test chooses for each relay id, and it keeps every request. The server
// code under test makes a real HTTP call to it, so the relay's contract is
// tested at the network boundary and not through a stubbed `fetch`.

import { setInstanceSettingsForTests } from "../lib/instance-settings";

export type RelayRequest = {
	relayId: string;
	kind: "alert" | "data" | "liveactivity";
	ciphertext: string;
	liveActivity?: {
		token?: string;
		event: "start" | "update" | "end";
		contentState: Record<string, string | number | boolean | null>;
		dismissalDate?: number;
		attributesType?: string;
		attributes?: Record<string, string | number | boolean | null>;
	};
};

type Answer = { status: number; error?: string };

export type FakeRelay = {
	url: string;
	requests: RelayRequest[];
	/** The answer for one relay id, until `reset`. Else 200. */
	answer: (relayId: string, answer: Answer) => void;
	reset: () => void;
	/** Turn `PUSH_RELAY_ENABLED` on or off, with the URL kept. */
	setEnabled: (on: boolean) => void;
	stop: () => Promise<void>;
};

const NAMES = ["PUSH_RELAY_ENABLED", "PUSH_RELAY_URL"] as const;

/** The real relay refuses a ciphertext over 3,072 base64url characters, and
 *  a Live Activity push with no token that is not a start with attributes. */
const invalid = (body: RelayRequest): boolean => {
	if (!/^[A-Za-z0-9_-]{1,3072}$/.test(body.ciphertext)) return true;
	if ((body.kind === "liveactivity") !== (body.liveActivity !== undefined)) {
		return true;
	}
	const activity = body.liveActivity;
	if (!activity || activity.token !== undefined) return false;
	return (
		activity.event !== "start" ||
		!activity.attributesType ||
		!activity.attributes
	);
};

/** Start the fake relay and point the instance settings at it. The
 *  environment wins over a test's settings, so the two names are taken out
 *  of it until `stop`. */
export const startFakeRelay = (): FakeRelay => {
	const requests: RelayRequest[] = [];
	const answers = new Map<string, Answer>();
	const server = Bun.serve({
		port: 0,
		fetch: async (request) => {
			// SAFETY: the server under test sends a `RelayPush` as JSON, and the
			// tests read only the fields that type names.
			const body = (await request.json()) as RelayRequest;
			// The two limits of the real relay's `pushBody` that a server can
			// break by itself. A push over them is a 400 there, so it is here.
			if (!invalid(body)) requests.push(body);
			else return Response.json({ error: "invalid_body" }, { status: 400 });
			const answer = answers.get(body.relayId) ?? { status: 200 };
			return Response.json(
				answer.error ? { error: answer.error } : { status: "delivered" },
				{ status: answer.status },
			);
		},
	});

	const saved = NAMES.map((name) => [name, process.env[name]] as const);
	for (const name of NAMES) delete process.env[name];
	const url = `http://localhost:${server.port}`;
	const setEnabled = (on: boolean) => {
		setInstanceSettingsForTests({
			PUSH_RELAY_ENABLED: on ? "true" : "false",
			PUSH_RELAY_URL: url,
		});
	};
	setEnabled(true);

	return {
		url,
		requests,
		answer: (relayId, answer) => {
			answers.set(relayId, answer);
		},
		reset: () => {
			requests.length = 0;
			answers.clear();
			setEnabled(true);
		},
		setEnabled,
		stop: async () => {
			setInstanceSettingsForTests(undefined);
			for (const [name, value] of saved) {
				if (value !== undefined) process.env[name] = value;
			}
			await server.stop(true);
		},
	};
};
