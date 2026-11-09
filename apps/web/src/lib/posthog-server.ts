import { setting } from "@farmer/core/lib/instance-settings";
import {
	DATABASE_ERROR_MESSAGE,
	isDatabaseErrorText,
	isQueryFreeMessage,
} from "@farmer/core/lib/loggable-error";
import { type EventMessage, PostHog } from "posthog-node";
import { z } from "zod";

/**
 * The server-side PostHog client, or null on a deployment without one.
 *
 * It reads the instance settings (`@farmer/core/lib/instance-settings`), not
 * `VITE_` variables, and so does the browser half (`posthogConfig` in
 * `routes/__root.tsx`). `vite build` substitutes a `VITE_` value inside the
 * Docker image, so it holds what CI was given, not the deployment's value.
 *
 * The client is rebuilt when the token or host changes, so a token fixed on
 * the page works without a restart.
 *
 * A missing token or host means PostHog is not set up here. Every caller gets
 * null and carries on.
 *
 * Development sends nothing, whatever the environment says. A developer's
 * `.env` copies a real deployment's token, and counted events cannot be
 * deleted. The gate is `NODE_ENV !== "production"`, as in `lib/dev-auth.ts`.
 * An opt-in variable can be copied to a server, but only a host that serves
 * people sets `NODE_ENV=production`. The Dockerfile and the `start` script pin
 * it. The browser half is gated the same way in `routes/__root.tsx`, and it
 * never receives the credentials.
 */
let posthogClient: { key: string; client: PostHog } | null = null;

export const posthogServerConfig = (): {
	token: string;
	host: string;
} | null => {
	if (process.env.NODE_ENV !== "production") return null;
	const token = setting("POSTHOG_PROJECT_TOKEN");
	const host = setting("POSTHOG_HOST");
	if (!token || !host) return null;
	return { token, host };
};

/** The parts of a `$exception_list` entry that this file reads. The other
 *  fields, `mechanism` and `stacktrace`, stay as they are. */
const exceptionList = z.array(
	z.looseObject({
		type: z.string().optional(),
		value: z.string().optional(),
	}),
);

/**
 * The `before_send` filter: an `$exception` event without the values of a
 * database query.
 *
 * `captureApiFailure` already sends a copy without them
 * (`withoutQueryValues`). But the client also reports each uncaught
 * exception and each unhandled rejection with the raw error, and a database
 * error can be one of them. Its message holds the parameters of its query: a
 * token, a token hash or an email address.
 *
 * posthog-node puts the error and each error of its `cause` chain in
 * `$exception_list`, with the class in `type` and the message in `value`.
 * When one entry is a database error, this replaces the `value` of each entry
 * with `Database error`. A message that `withoutQueryValues` made stays, so
 * the code and the constraint stay. The `type` and the stack frames stay, so
 * PostHog still groups the event. A frame holds a file name, a function and
 * lines of the source, not the message. The event always stays.
 */
export const withoutDatabaseValues = (
	event: EventMessage | null,
): EventMessage | null => {
	if (event?.event !== "$exception") return event;
	const parsed = exceptionList.safeParse(event.properties?.$exception_list);
	if (!parsed.success) return event;
	const list = parsed.data;
	if (!list.some((entry) => isDatabaseErrorText(entry.type, entry.value))) {
		return event;
	}
	const safeValue = (value: string | undefined) =>
		value !== undefined && isQueryFreeMessage(value)
			? value
			: DATABASE_ERROR_MESSAGE;
	const scrubbed = list.map((entry) => ({
		...entry,
		value: safeValue(entry.value),
	}));
	const properties = { ...event.properties, $exception_list: scrubbed };
	// The Sentry integration also copies the first message to the top level.
	if ("$exception_message" in properties) {
		properties.$exception_message = safeValue(scrubbed[0]?.value);
	}
	return { ...event, properties };
};

export function getPostHogClient(): PostHog | null {
	const config = posthogServerConfig();
	if (!config) return null;
	const key = `${config.host}\n${config.token}`;
	if (posthogClient?.key === key) return posthogClient.client;

	// The old client flushes what it holds before it goes; nothing waits on it.
	void posthogClient?.client.shutdown();
	const client = new PostHog(config.token, {
		host: config.host,
		flushAt: 1,
		flushInterval: 0,
		enableExceptionAutocapture: true,
		before_send: withoutDatabaseValues,
	});
	posthogClient = { key, client };
	return client;
}
