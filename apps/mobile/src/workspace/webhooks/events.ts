import type { NewWebhookEndpoint, WebhookEndpoint } from "@farmer/api-client";

import type { BadgeTone } from "../components";

/** The name of one event kind that an endpoint can subscribe to. */
export type WebhookEventKind = NewWebhookEndpoint["enabledEvents"][number];

/**
 * The event kinds in the order of the web app. The web app shows the kind
 * name as the label. The description is a short help line for a small
 * screen.
 */
export const WEBHOOK_EVENTS = [
	{ value: "time_entry.created", description: "A time entry is added." },
	{ value: "time_entry.updated", description: "A time entry is changed." },
	{ value: "time_entry.deleted", description: "A time entry is deleted." },
	{ value: "absence.created", description: "Time off is added." },
	{ value: "absence.removed", description: "Time off is removed." },
	{ value: "project.created", description: "A project is created." },
	{ value: "project.updated", description: "A project is changed." },
	{ value: "client.created", description: "A client is created." },
	{ value: "member.added", description: "A person joins the workspace." },
	{ value: "member.archived", description: "A person is archived." },
	{ value: "import.finished", description: "A Harvest import ends." },
	{ value: "webhook.test", description: "The test event of this screen." },
] satisfies { value: WebhookEventKind; description: string }[];

/** Adds or removes one kind. The result keeps the order of the catalogue,
 *  so two endpoints with the same events read the same. */
export const toggleEvent = (
	chosen: readonly WebhookEventKind[],
	kind: WebhookEventKind,
): WebhookEventKind[] => {
	const next = new Set(chosen);
	if (next.has(kind)) next.delete(kind);
	else next.add(kind);
	return WEBHOOK_EVENTS.map((event) => event.value).filter((value) =>
		next.has(value),
	);
};

/** The longest URL that the server takes. */
const MAX_URL_LENGTH = 2048;

/**
 * The first problem of a URL, as a sentence, or null. The server refuses a
 * URL that is not https, or that points to a private address. It sends its
 * own sentence for those, and the screen shows it as it is.
 */
export const urlProblemOf = (value: string): string | null => {
	const url = value.trim();
	if (url === "") return "Enter a URL";
	if (url.length > MAX_URL_LENGTH) return "That URL is too long";
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return "That is not a valid URL";
	}
	if (parsed.protocol !== "https:") return "The URL must start with https://";
	if (parsed.username !== "" || parsed.password !== "") {
		return "Remove the username and password from the URL";
	}
	return null;
};

/** A short word and the badge tone that goes with it. */
export type Status = { label: string; tone: BadgeTone };

/** How an endpoint is doing, in the words of the web app. */
export const healthOf = (
	endpoint: Pick<
		WebhookEndpoint,
		"disabledAt" | "failingSince" | "lastSuccessAt"
	>,
): Status => {
	if (endpoint.disabledAt) return { label: "Off", tone: "neutral" };
	if (endpoint.failingSince) return { label: "Failing", tone: "error" };
	if (endpoint.lastSuccessAt) return { label: "Delivering", tone: "success" };
	return { label: "Untested", tone: "accent" };
};
