import type { z } from "zod";

import { ApiClientError } from "./errors";
import {
	apiErrorSchema,
	type ConfirmTimer,
	deletedSchema,
	meSchema,
	type NewTimeEntry,
	projectSchema,
	type StartTimer,
	taskListSchema,
	timeEntrySchema,
	type TimeEntryPatch,
	timerStateSchema,
	trackingSchema,
	unfiledEntrySchema,
	whoamiSchema,
} from "./schemas";
import { type HttpMethod, readJson, send, type Transport } from "./transport";

const ORG_ROUTE_PREFIX = "/api/v1/orgs/";

const orgPath = (slug: string, suffix: string) =>
	`${ORG_ROUTE_PREFIX}${encodeURIComponent(slug)}${suffix}`;

const range = (from: string, to: string) =>
	`?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

/**
 * A typed client for the routes of `/api/v1` the app uses. Every answer is
 * parsed with its schema, and every failure is an `ApiClientError`.
 */
export class FarmerClient {
	readonly #transport: Transport;
	readonly #token: string;

	constructor(transport: Transport, token: string) {
		this.#transport = transport;
		this.#token = token;
	}

	get origin(): string {
		return this.#transport.origin;
	}

	me() {
		return this.#request("GET", "/api/v1/me", meSchema);
	}

	/** Revokes the token this client holds, and no other. */
	async signOut(): Promise<void> {
		const response = await send(this.#transport, {
			method: "DELETE",
			path: "/api/v1/session",
			token: this.#token,
		});
		// A 401 means the token was already dead, which is the goal.
		if (response.ok || response.status === 401) return;
		throw await this.#failure(response, "/api/v1/session");
	}

	whoami(slug: string) {
		return this.#request("GET", orgPath(slug, "/whoami"), whoamiSchema);
	}

	projects(slug: string) {
		return this.#request(
			"GET",
			orgPath(slug, "/projects"),
			projectSchema.array(),
		);
	}

	tasks(slug: string) {
		return this.#request("GET", orgPath(slug, "/tasks"), taskListSchema);
	}

	tracking(slug: string) {
		return this.#request("GET", orgPath(slug, "/tracking"), trackingSchema);
	}

	/** Note: this read recomputes the fill blocks of the days it covers on the
	 *  server, so a caller must not ask it more often than a person would. */
	timeEntries(slug: string, from: string, to: string) {
		return this.#request(
			"GET",
			orgPath(slug, `/time-entries${range(from, to)}`),
			timeEntrySchema.array(),
		);
	}

	unfiled(slug: string, from: string, to: string) {
		return this.#request(
			"GET",
			orgPath(slug, `/unfiled${range(from, to)}`),
			unfiledEntrySchema.array(),
		);
	}

	createTimeEntry(slug: string, body: NewTimeEntry) {
		return this.#request(
			"POST",
			orgPath(slug, "/time-entries"),
			timeEntrySchema,
			body,
		);
	}

	updateTimeEntry(slug: string, id: string, patch: TimeEntryPatch) {
		return this.#request(
			"PATCH",
			orgPath(slug, `/time-entries/${encodeURIComponent(id)}`),
			timeEntrySchema,
			patch,
		);
	}

	deleteTimeEntry(slug: string, id: string) {
		return this.#request(
			"DELETE",
			orgPath(slug, `/time-entries/${encodeURIComponent(id)}`),
			deletedSchema,
		);
	}

	timer(slug: string) {
		return this.#request("GET", orgPath(slug, "/timer"), timerStateSchema);
	}

	startTimer(slug: string, body: StartTimer) {
		return this.#request(
			"POST",
			orgPath(slug, "/timer"),
			timerStateSchema,
			body,
		);
	}

	pauseTimer(slug: string) {
		return this.#request(
			"POST",
			orgPath(slug, "/timer/pause"),
			timerStateSchema,
		);
	}

	resumeTimer(slug: string) {
		return this.#request(
			"POST",
			orgPath(slug, "/timer/resume"),
			timerStateSchema,
		);
	}

	/** Discards a running timer, or clears the notice of a dropped one. */
	discardTimer(slug: string) {
		return this.#request("DELETE", orgPath(slug, "/timer"), timerStateSchema);
	}

	/** Stops the timer and logs the entry. Only after the person saw the
	 *  snapped figure in the confirm sheet (ADR 0003). */
	confirmTimer(slug: string, body: ConfirmTimer) {
		return this.#request(
			"POST",
			orgPath(slug, "/timer/confirm"),
			timeEntrySchema,
			body,
		);
	}

	async #request<S extends z.ZodType>(
		method: HttpMethod,
		path: string,
		schema: S,
		body?: NewTimeEntry | TimeEntryPatch | StartTimer | ConfirmTimer,
	): Promise<z.output<S>> {
		const response = await send(this.#transport, {
			method,
			path,
			token: this.#token,
			body: body === undefined ? undefined : JSON.stringify(body),
		});
		if (!response.ok) throw await this.#failure(response, path);
		const parsed = schema.safeParse(await readJson(response));
		if (!parsed.success) {
			throw new ApiClientError(
				"invalid_response",
				`${this.origin} sent an answer this app cannot read. The server may be newer than the app: update the app.`,
				{ status: response.status },
			);
		}
		return parsed.data;
	}

	async #failure(response: Response, path: string): Promise<ApiClientError> {
		const body = apiErrorSchema.safeParse(await readJson(response));
		const details = body.success
			? {
					status: response.status,
					code: body.data.code,
					issues: body.data.issues,
				}
			: { status: response.status };

		if (response.status === 401) {
			// An org route answers 401 for a workspace the person is not in as
			// well as for a dead token. `/me` tells the two apart.
			if (path.startsWith(ORG_ROUTE_PREFIX) && (await this.#tokenWorks())) {
				return new ApiClientError(
					"no_access",
					"You no longer have access to this workspace.",
					details,
				);
			}
			return new ApiClientError(
				"unauthorized",
				"Your session has ended. Sign in again.",
				details,
			);
		}
		if (response.status === 404 && !body.success) {
			return new ApiClientError(
				"unsupported",
				`${this.origin} does not have this feature yet. Ask the administrator to update it.`,
				details,
			);
		}
		if (body.success) {
			const issues = (body.data.issues ?? []).map((issue) => issue.message);
			return new ApiClientError(
				"http",
				[body.data.error, ...issues].join("\n"),
				details,
			);
		}
		return new ApiClientError(
			"http",
			`${this.origin} answered ${response.status}. Try again.`,
			details,
		);
	}

	async #tokenWorks(): Promise<boolean> {
		const response = await send(this.#transport, {
			method: "GET",
			path: "/api/v1/me",
			token: this.#token,
		});
		return response.ok;
	}
}
