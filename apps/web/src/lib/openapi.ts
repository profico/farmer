import {
	type ApiAbsenceResult,
	type ApiCopyResult,
	type ApiDeleted,
	type ApiError,
	type ApiFileResult,
	type ApiMe,
	type ApiMeta,
	type ApiPeriod,
	type ApiProject,
	type ApiProjectRef,
	type ApiSyncResult,
	type ApiTask,
	type ApiTaskList,
	type ApiTaskRef,
	type ApiTimeEntry,
	type ApiTimer,
	type ApiTimerState,
	type ApiTracking,
	type ApiUnfiledEntry,
	type ApiWhoami,
	API_TOKEN_PREFIX,
	CLI_CLIENT_ID,
	CLI_VERSION_HEADER,
} from "@farmer/core/api";
import {
	confirmTimerInput,
	copyTimeEntriesInput,
	copyWeekEntriesInput,
	createTimeEntryInput,
	fileTimeEntriesInput,
	listTimeEntriesRangeInput,
	logAbsenceRangeInput,
	repositoryProjectsInput,
	startTimerInput,
	updateTimeEntryInput,
} from "@farmer/core/schema";
import { z } from "zod";

import { SESSION_REQUEST_HEADER } from "./api-session-header.ts";

/**
 * The OpenAPI 3.1 document for `/api/v1`, which `/api-docs` renders with
 * Scalar and `GET /api/v1/openapi.json` serves.
 *
 * Nothing here is written twice. A request body is the Zod schema from
 * `@farmer/core/schema` that the route itself parses, and a response is a
 * schema that must agree with its `@farmer/core/api` type (see `mirror`), so a
 * field added to either side without the other fails `typecheck`. A route
 * added under `routes/api/v1` without an entry in `OPERATIONS` fails
 * `openapi.test.ts`.
 *
 * Only the routes that take a bearer token are here. `api/v1/projects` and
 * `api/v1/time-entries` are the web app's own cookie-authed reads.
 */

/** True when each of `A` and `B` is assignable to the other. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/**
 * A response schema that must describe exactly `T`, the type the route
 * answers. When the two drift apart, the argument's type becomes `never` and
 * the call stops compiling.
 */
const mirror =
	<T>() =>
	<S extends z.ZodType>(
		schema: S & (Same<T, z.output<S>> extends true ? S : never),
	): S =>
		schema;

/** Every named schema, so the document holds each one once, under
 *  `components.schemas`, and refers to it from each operation. */
const components = z.registry<{ id: string }>();

const named = <S extends z.ZodType>(id: string, schema: S): S => {
	components.add(schema, { id });
	return schema;
};

const uuid = z.string().describe("A UUID.");
const dayKey = z.string().describe("A day, yyyy-MM-dd.");
const iso = z.string().describe("An instant, ISO 8601 in UTC.");

const projectRole = z
	.enum(["member", "team_lead", "pm"])
	.describe("The role the caller holds on the project.");

const apiError = named(
	"Error",
	mirror<ApiError>()(
		z
			.object({
				error: z
					.string()
					.describe(
						"A sentence for a person. Its wording can change at any time.",
					),
				code: z
					.enum([
						"unauthorized",
						"forbidden",
						"not_found",
						"invalid_input",
						"rate_limited",
						"cli_outdated",
						"server_error",
					])
					.describe("What a client branches on. A new code is an addition."),
				issues: z
					.array(z.object({ path: z.string(), message: z.string() }))
					.optional()
					.describe("One item per invalid field, on `invalid_input`."),
			})
			.describe("The body of every error response."),
	),
);

const apiMeta = named(
	"Meta",
	mirror<ApiMeta>()(
		z.object({
			app: z.literal("farmer"),
			cliEnabled: z
				.boolean()
				.describe(
					"False when this deployment has the API switched off. Every other route then answers 404.",
				),
			minCliVersion: z.string(),
		}),
	),
);

const apiMe = named(
	"Me",
	mirror<ApiMe>()(
		z.object({
			user: z.object({ id: uuid, name: z.string(), email: z.string() }),
			organizations: z
				.array(z.object({ slug: z.string(), name: z.string() }))
				.describe("Each slug is the `orgSlug` of every other route."),
		}),
	),
);

const apiWhoami = named(
	"Whoami",
	mirror<ApiWhoami>()(
		z.object({
			userId: uuid,
			name: z.string().nullable(),
			email: z.string().nullable(),
			organization: z.object({ slug: z.string(), name: z.string() }),
			orgRole: z.string().nullable(),
			isAdmin: z.boolean(),
			timezone: z.string().describe("The organization's IANA timezone."),
			today: dayKey.describe("Today, in `timezone`."),
			weekStartsOn: z
				.union([z.literal(0), z.literal(1)])
				.describe("1 is Monday, 0 is Sunday."),
			workingDays: z
				.array(
					z.object({
						dayOfWeek: z.number().int().describe("0 is Sunday."),
						startTime: z.string().describe("HH:mm."),
						endTime: z.string().describe("HH:mm."),
					}),
				)
				.describe("The enabled days only."),
			projects: z.array(
				z.object({ id: uuid, name: z.string(), role: projectRole.nullable() }),
			),
		}),
	),
);

const apiTaskRef = named(
	"TaskRef",
	mirror<ApiTaskRef>()(
		z.object({ id: uuid, name: z.string(), isAbsence: z.boolean() }),
	),
);

const client = z.object({ id: uuid, name: z.string() });

const apiProjectRef = named(
	"ProjectRef",
	mirror<ApiProjectRef>()(
		z.object({
			id: uuid,
			name: z.string(),
			code: z.string().nullable(),
			client,
		}),
	),
);

const apiTimeEntry = named(
	"TimeEntry",
	mirror<ApiTimeEntry>()(
		z.object({
			id: uuid,
			date: dayKey,
			durationSeconds: z.number().int(),
			description: z.string(),
			overtime: z.boolean(),
			fillsDay: z
				.boolean()
				.describe(
					"A rest-of-day block: its duration follows the day, nobody typed it.",
				),
			synced: z
				.boolean()
				.describe(
					"Mirrors a calendar event. Google still owns it unless it was filed.",
				),
			commitCount: z.number().int(),
			task: apiTaskRef,
			project: apiProjectRef
				.nullable()
				.describe("Null for time off, a Break, and anything not yet filed."),
		}),
	),
);

const apiUnfiledEntry = named(
	"UnfiledEntry",
	mirror<ApiUnfiledEntry>()(
		z.object({
			id: uuid,
			date: dayKey,
			durationSeconds: z.number().int(),
			description: z.string(),
			task: z.object({ id: uuid, name: z.string() }),
			meetingUrl: z.string().nullable(),
		}),
	),
);

const apiFileResult = named(
	"FileResult",
	mirror<ApiFileResult>()(
		z.object({
			filed: z.number().int(),
			failed: z.number().int(),
			firstError: z.string().nullable(),
		}),
	),
);

const apiCopyResult = named(
	"CopyResult",
	mirror<ApiCopyResult>()(
		z.object({
			copied: z.number().int(),
			skipped: z.number().int(),
			blockedDays: z
				.array(dayKey)
				.describe(
					"The days a week copy left alone because they would pass 24 hours. Always empty for a day copy.",
				),
		}),
	),
);

const apiAbsenceResult = named(
	"AbsenceResult",
	mirror<ApiAbsenceResult>()(
		z.object({
			booked: z.array(
				z.object({ date: dayKey, durationSeconds: z.number().int() }),
			),
			skipped: z
				.array(z.object({ date: dayKey, reason: z.string() }))
				.describe("A weekend, a public holiday or a day already off."),
		}),
	),
);

const apiDeleted = named(
	"Deleted",
	mirror<ApiDeleted>()(z.object({ id: uuid.describe("The id it removed.") })),
);

const apiProject = named(
	"Project",
	mirror<ApiProject>()(
		z.object({
			id: uuid,
			name: z.string(),
			code: z.string().nullable(),
			status: z.string(),
			client,
			role: projectRole.nullable(),
		}),
	),
);

const apiTask = named(
	"Task",
	mirror<ApiTask>()(
		z.object({
			id: uuid,
			name: z.string(),
			group: z.string(),
			isAbsence: z.boolean(),
			systemKey: z.string().nullable(),
		}),
	),
);

const apiTaskList = named(
	"TaskList",
	mirror<ApiTaskList>()(
		z.object({
			tasks: z.array(apiTask).describe("Work tasks, to log time against."),
			absenceTasks: z
				.array(apiTask)
				.describe("Absence tasks, for `POST /absences`."),
		}),
	),
);

const apiPeriod = named(
	"Period",
	mirror<ApiPeriod>()(
		z.object({
			from: dayKey,
			to: dayKey,
			workingDays: z.number().int(),
			workingDaysElapsed: z
				.number()
				.int()
				.describe("Working days before today."),
			workingDaysThroughToday: z
				.number()
				.int()
				.describe(
					"Working days before today, plus today when today is a working day.",
				),
			targetSeconds: z.number().int().nullable(),
			targetSoFarSeconds: z
				.number()
				.int()
				.nullable()
				.describe(
					"The target for the working days before today. The status compares against this. It is 0 on the first working day of a period.",
				),
			targetThroughTodaySeconds: z
				.number()
				.int()
				.nullable()
				.describe(
					"The goal including today: what the person should have logged by the end of today. The status does not read it.",
				),
			workSeconds: z.number().int(),
			timeOffSeconds: z.number().int(),
			totalSeconds: z.number().int(),
			totalSoFarSeconds: z.number().int(),
			status: z
				.enum(["on_track", "slightly_behind", "behind"])
				.nullable()
				.describe("Null when no target applies to the person."),
		}),
	),
);

const apiTracking = named(
	"Tracking",
	mirror<ApiTracking>()(
		z.object({
			today: dayKey,
			daySeconds: z.number().int(),
			tolerancePct: z.number(),
			week: apiPeriod,
			month: apiPeriod,
		}),
	),
);

const apiSyncResult = named(
	"SyncResult",
	mirror<ApiSyncResult>()(
		z.object({
			stillRunning: z
				.boolean()
				.describe(
					"The sync took longer than the request may stay open and continues on the server. The four lists are then empty.",
				),
			ran: z.array(z.string()),
			skipped: z.array(z.string()),
			failed: z.array(z.string()),
			off: z.array(z.string()),
		}),
	),
);

const apiTimer = named(
	"Timer",
	mirror<ApiTimer>()(
		z.object({
			id: uuid,
			startedAt: iso,
			droppedAt: iso
				.nullable()
				.describe(
					"Set when the timer passed the person's limit and was dropped. Nothing was logged. Null while it runs.",
				),
			paused: z.boolean(),
			elapsedSeconds: z.number().int(),
			snappedSeconds: z
				.number()
				.int()
				.describe(
					"What confirming would log: the elapsed time, snapped to the nearest quarter hour.",
				),
			serverNow: iso.describe(
				"The instant `elapsedSeconds` was measured at. Count from this, not from the local clock.",
			),
			description: z.string(),
			task: z.object({
				id: uuid,
				name: z.string(),
				needsDescription: z.boolean(),
			}),
			project: z.object({ id: uuid, name: z.string() }).nullable(),
			entry: z
				.object({ id: uuid, date: dayKey, durationSeconds: z.number().int() })
				.nullable()
				.describe(
					"The entry this timer continues, or null when confirming logs a new one.",
				),
			organization: z
				.object({ slug: z.string(), name: z.string(), here: z.boolean() })
				.describe(
					"A timer belongs to the person, not to an organization, so another organization can answer it. `here` says whether it runs in this one.",
				),
		}),
	),
);

const apiTimerState = named(
	"TimerState",
	mirror<ApiTimerState>()(
		z.object({
			timer: apiTimer.nullable().describe("Null when nothing is timing."),
		}),
	),
);

// The request bodies the routes parse, under the names the document shows.
named("NewTimeEntry", createTimeEntryInput);
named("TimeEntryPatch", updateTimeEntryInput);
named("FileTimeEntries", fileTimeEntriesInput);
named("CopyDay", copyTimeEntriesInput);
named("CopyWeek", copyWeekEntriesInput);
named("AbsenceRange", logAbsenceRangeInput);
named("StartTimer", startTimerInput);
named("ConfirmTimer", confirmTimerInput);

type JsonSchema = z.core.JSONSchema.JSONSchema;

/** `components.schemas`: each schema under the id it was registered with. */
type SchemaComponents = { [id: string]: JsonSchema };

/** The components, with the `$schema` and `$id` that `toJSONSchema` stamps on
 *  each. An OpenAPI document states its dialect once, at the top. */
const componentSchemas = () => {
	const { schemas } = z.toJSONSchema(components, {
		// `input`, because an output object is closed with
		// `additionalProperties: false`, and a response is not: a field can be
		// added to it at any time. A client must ignore the fields it does not
		// know.
		io: "input",
		// A `.refine` has no JSON Schema form. The operation's text says it.
		unrepresentable: "any",
		uri: (id) => `#/components/schemas/${id}`,
	});
	const clean: SchemaComponents = {};
	for (const [id, { $schema: _dialect, $id: _id, ...rest }] of Object.entries(
		schemas,
	)) {
		clean[id] = rest;
	}

	// A PATCH body is any subset of the fields, merged over the stored entry.
	// The route takes the id from the path.
	const patch = clean.TimeEntryPatch;
	if (patch?.properties) {
		const { timeEntryId: _fromPath, ...properties } = patch.properties;
		clean.TimeEntryPatch = {
			type: "object",
			properties,
			description:
				"Any subset of the entry's fields. Each one replaces the stored value; `null` clears an optional field.",
		};
	}
	return clean;
};

type SchemaRef = { $ref: string };

const ref = (schema: z.ZodType): SchemaRef => {
	const id = components.get(schema)?.id;
	if (!id) throw new Error("A response schema is not registered.");
	return { $ref: `#/components/schemas/${id}` };
};

type Method = "get" | "post" | "patch" | "delete";

type Tag = "Account" | "Time entries" | "Timer" | "Time off" | "Projects";

type Operation = {
	method: Method;
	/** Relative to `/api/v1`, with `{orgSlug}` and `{id}` where the route has
	 *  them. */
	path: string;
	operationId: string;
	summary: string;
	description?: string;
	tag: Tag;
	/** False only for `GET /meta`. */
	auth?: false;
	/** Query parameters: the properties of this object schema. */
	query?: { schema: z.ZodType; optional: boolean };
	body?: z.ZodType;
	/** The 200 body, or `null` for a 204. */
	response: z.ZodType | null;
	list?: true;
};

const rangeQuery = { schema: listTimeEntriesRangeInput, optional: true };

const RANGE_TEXT =
	"`from` and `to` are optional and default to today in the organization's timezone. The range can span 62 days at most.";

export const OPERATIONS: Operation[] = [
	{
		method: "get",
		path: "/meta",
		operationId: "getMeta",
		summary: "Check the server",
		description:
			"Confirms that the URL is a Farmer server and that the API is switched on. Takes no credential.",
		tag: "Account",
		auth: false,
		response: apiMeta,
	},
	{
		method: "get",
		path: "/me",
		operationId: "getMe",
		summary: "Get the signed-in person",
		description:
			"The person the token belongs to, and the organizations they can use.",
		tag: "Account",
		response: apiMe,
	},
	{
		method: "delete",
		path: "/session",
		operationId: "signOut",
		summary: "Revoke the token",
		description:
			"Revokes the token the request sends: it ends a device-flow session, or deletes an API token. The token stops working at once. A read-only API token can revoke itself.",
		tag: "Account",
		response: null,
	},
	{
		method: "get",
		path: "/orgs/{orgSlug}/whoami",
		operationId: "whoami",
		summary: "Get the person in an organization",
		description:
			"Their role, the organization's timezone and first day of the week, their working days and their projects.",
		tag: "Account",
		response: apiWhoami,
	},
	{
		method: "get",
		path: "/orgs/{orgSlug}/time-entries",
		operationId: "listTimeEntries",
		summary: "List time entries",
		description: RANGE_TEXT,
		tag: "Time entries",
		query: rangeQuery,
		response: apiTimeEntry,
		list: true,
	},
	{
		method: "post",
		path: "/orgs/{orgSlug}/time-entries",
		operationId: "createTimeEntry",
		summary: "Log time",
		description:
			"`durationSeconds` is a multiple of 900 (a quarter hour), and a day holds 24 hours at most. Most tasks need a `description`; time off and a Break do not.",
		tag: "Time entries",
		body: createTimeEntryInput,
		response: apiTimeEntry,
	},
	{
		method: "patch",
		path: "/orgs/{orgSlug}/time-entries/{id}",
		operationId: "updateTimeEntry",
		summary: "Change a time entry",
		tag: "Time entries",
		body: updateTimeEntryInput,
		response: apiTimeEntry,
	},
	{
		method: "delete",
		path: "/orgs/{orgSlug}/time-entries/{id}",
		operationId: "deleteTimeEntry",
		summary: "Delete a time entry",
		tag: "Time entries",
		response: apiDeleted,
	},
	{
		method: "get",
		path: "/orgs/{orgSlug}/unfiled",
		operationId: "listUnfiled",
		summary: "List unfiled time",
		description: `Worked time that has no project yet, such as a synced meeting. ${RANGE_TEXT}`,
		tag: "Time entries",
		query: rangeQuery,
		response: apiUnfiledEntry,
		list: true,
	},
	{
		method: "post",
		path: "/orgs/{orgSlug}/time-entries/file",
		operationId: "fileTimeEntries",
		summary: "File entries to a project",
		description:
			"Moves up to 200 entries to one project. `remember` also adds a filing rule, so the same meeting goes to that project next time.",
		tag: "Time entries",
		body: fileTimeEntriesInput,
		response: apiFileResult,
	},
	{
		method: "post",
		path: "/orgs/{orgSlug}/time-entries/copy-day",
		operationId: "copyDay",
		summary: "Copy a day",
		description:
			"Copies the entries of `fromDate` to `toDate`. Refuses with `invalid_input` when the copy would pass 24 hours.",
		tag: "Time entries",
		body: copyTimeEntriesInput,
		response: apiCopyResult,
	},
	{
		method: "post",
		path: "/orgs/{orgSlug}/time-entries/copy-week",
		operationId: "copyWeek",
		summary: "Copy a week",
		description:
			"Copies each day of the week that starts on `fromWeekStart`. A day that would pass 24 hours is left alone and named in `blockedDays`.",
		tag: "Time entries",
		body: copyWeekEntriesInput,
		response: apiCopyResult,
	},
	{
		method: "post",
		path: "/orgs/{orgSlug}/absences",
		operationId: "logAbsence",
		summary: "Book time off",
		description:
			"Books an absence task on each day from `from` to `to` that the person works. The server skips weekends, public holidays and days already off. The range can span 62 days at most.",
		tag: "Time off",
		body: logAbsenceRangeInput,
		response: apiAbsenceResult,
	},
	{
		method: "delete",
		path: "/orgs/{orgSlug}/absences/{id}",
		operationId: "deleteAbsence",
		summary: "Delete time off",
		tag: "Time off",
		response: apiDeleted,
	},
	{
		method: "get",
		path: "/orgs/{orgSlug}/projects",
		operationId: "listProjects",
		summary: "List projects",
		description: "The projects the caller can log time to.",
		tag: "Projects",
		response: apiProject,
		list: true,
	},
	{
		method: "get",
		path: "/orgs/{orgSlug}/repository-projects",
		operationId: "listRepositoryProjects",
		summary: "List the projects of a repository",
		description:
			"The caller's projects that a GitHub repository (`owner/name`) is linked to.",
		tag: "Projects",
		query: { schema: repositoryProjectsInput, optional: false },
		response: apiProject,
		list: true,
	},
	{
		method: "get",
		path: "/orgs/{orgSlug}/tasks",
		operationId: "listTasks",
		summary: "List tasks",
		tag: "Projects",
		response: apiTaskList,
	},
	{
		method: "get",
		path: "/orgs/{orgSlug}/tracking",
		operationId: "getTracking",
		summary: "Get the week and month against target",
		description: "The same figures as the home page.",
		tag: "Time entries",
		response: apiTracking,
	},
	{
		method: "post",
		path: "/orgs/{orgSlug}/sync",
		operationId: "sync",
		summary: "Sync now",
		description:
			"Runs the caller's automations, the same as Sync now in the web app.",
		tag: "Time entries",
		response: apiSyncResult,
	},
	{
		method: "get",
		path: "/orgs/{orgSlug}/timer",
		operationId: "getTimer",
		summary: "Get the timer",
		tag: "Timer",
		response: apiTimerState,
	},
	{
		method: "post",
		path: "/orgs/{orgSlug}/timer",
		operationId: "startTimer",
		summary: "Start the timer",
		description:
			"Send `taskId`, or `timeEntryId` to continue an existing entry. `headStartSeconds` is time already worked before the start.",
		tag: "Timer",
		body: startTimerInput,
		response: apiTimerState,
	},
	{
		method: "post",
		path: "/orgs/{orgSlug}/timer/pause",
		operationId: "pauseTimer",
		summary: "Pause the timer",
		tag: "Timer",
		response: apiTimerState,
	},
	{
		method: "post",
		path: "/orgs/{orgSlug}/timer/resume",
		operationId: "resumeTimer",
		summary: "Resume the timer",
		tag: "Timer",
		response: apiTimerState,
	},
	{
		method: "post",
		path: "/orgs/{orgSlug}/timer/confirm",
		operationId: "confirmTimer",
		summary: "Stop the timer and log the time",
		description:
			"Logs the entry and clears the timer. Every field is optional, and an absent one takes the live value: the entry's own for a timer that continues one, else the timer's. Leave `durationSeconds` out to log the entry's live hours plus the measured time, snapped to a quarter hour. Send `measuredSeconds` to log the measured part you showed instead. Compute it as `snappedSeconds` minus `entry.durationSeconds` (0 without an entry). The server adds the live entry hours and snaps the sum. Send `durationSeconds` for a figure the person corrected: it wins.",
		tag: "Timer",
		body: confirmTimerInput,
		response: apiTimeEntry,
	},
	{
		method: "delete",
		path: "/orgs/{orgSlug}/timer",
		operationId: "discardTimer",
		summary: "Discard the timer",
		description: "Clears the timer without logging anything.",
		tag: "Timer",
		response: apiTimerState,
	},
];

const TAG_TEXT = {
	Account: "The server, the token and the person it belongs to.",
	"Time entries": "The timesheet: read it, log time, file it and copy it.",
	Timer: "The stopwatch. One per person, across every organization.",
	"Time off": "Vacation, sick leave and the other absence tasks.",
	Projects: "What a person can log time against.",
} satisfies Record<Tag, string>;

/** Preferences → API tokens in the reader's own workspace: `:org` is the
 *  placeholder the `/$orgSlug` guard resolves (lib/org-redirect.ts), and the
 *  chooser keeps the fragment when the reader has more than one. */
const API_TOKENS_PAGE = "/:org/settings/preferences#api-tokens";

const INTRO = `The REST API that the \`farmer\` CLI uses. Every call acts as one person and can do only what that person can do in the web app.

## Authentication

Send a token in the \`Authorization\` header:

\`\`\`sh
curl "$FARMER/api/v1/me" -H "Authorization: Bearer <token>"
\`\`\`

The examples set \`FARMER\` to your deployment's address. There are two kinds of token.

### API token (recommended)

Use an API token for a script, a scheduled job or an integration. Make one in Farmer at [Preferences → API tokens](${API_TOKENS_PAGE}). A token starts with \`${API_TOKEN_PREFIX}\`, and Farmer shows it only once.

- **Access.** A read-only token gets 403 \`forbidden\` on a request that changes data. Give the token write access only if the script needs it.
- **Workspaces.** A token can work in one workspace only, or in all the workspaces of its owner.
- **Expiry.** A token expires after 30 days, 90 days or one year, or never. Revoke a token [in Preferences](${API_TOKENS_PAGE}) at any time.

### Device flow

The \`farmer\` CLI uses the device flow ([RFC 8628](https://www.rfc-editor.org/rfc/rfc8628)), because a person approves each login in a browser. Use it for a tool that a person runs interactively. Do not use it for a script that runs without a person.

**1. Ask for a code.**

\`\`\`sh
curl -X POST "$FARMER/api/auth/device/code" \\
  -H "Content-Type: application/json" \\
  -d '{"client_id": "${CLI_CLIENT_ID}"}'
\`\`\`

The answer holds \`device_code\`, \`verification_uri_complete\` and \`interval\`.

**2. Approve it.** Open \`verification_uri_complete\` in a browser, sign in and approve the code.

**3. Collect the token.** Send this every \`interval\` seconds until the answer holds \`access_token\`:

\`\`\`sh
curl -X POST "$FARMER/api/auth/device/token" \\
  -H "Content-Type: application/json" \\
  -d '{
    "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
    "device_code": "<device_code>",
    "client_id": "${CLI_CLIENT_ID}"
  }'
\`\`\`

**4. Use it** as the bearer token.

\`DELETE /session\` revokes the token that the request sends, of either kind.

## Organizations

Most routes start with \`/orgs/{orgSlug}\`. \`GET /me\` lists the slugs the token can use. A token for one workspace lists only that workspace.

## Errors

An error answers the \`Error\` body. Branch on \`code\`, not on the \`error\` text.

| Status | \`code\` | Meaning |
| --- | --- | --- |
| 401 | \`unauthorized\` | No token, a token that is not valid or has expired, or an organization the person is not in or the token cannot use. |
| 403 | \`forbidden\` | The person may not do this, for example log time on a project they are not assigned to. A read-only API token also gets 403 on a request that changes data. |
| 404 | \`not_found\` | No such record. |
| 422 | \`invalid_input\` | The body or the query is not valid, or the values break a rule, such as a day over 24 hours. \`issues\` names each field. |
| 429 | \`rate_limited\` | Too many calls. Wait for \`Retry-After\` seconds. |
| 500 | \`server_error\` | Something failed on the server. |

The CLI also sends \`${CLI_VERSION_HEADER}\` and can get 426 \`cli_outdated\`. Other clients do not send the header, so they never get 426.

## Compatibility

A response can get new fields at any time. Ignore the fields you do not know.`;

type ResponseObject = {
	description: string;
	content?: {
		"application/json": {
			schema: SchemaRef | { type: "array"; items: SchemaRef };
		};
	};
};

/** An operation's responses, keyed by status code. */
type Responses = { [status: string]: ResponseObject };

const errorResponse = (description: string): ResponseObject => ({
	description,
	content: { "application/json": { schema: ref(apiError) } },
});

/** The parameters of a query schema, one per property. */
const queryParameters = (query: NonNullable<Operation["query"]>) => {
	const json = z.toJSONSchema(query.schema, {
		io: "input",
		unrepresentable: "any",
	});
	const required = new Set(query.optional ? [] : (json.required ?? []));
	return Object.entries(json.properties ?? {}).map(([name, schema]) => ({
		name,
		in: "query",
		required: required.has(name),
		schema,
	}));
};

const pathParameters = (path: string, orgSlug: string | undefined) =>
	[...path.matchAll(/\{(\w+)\}/g)].map(([, name]) => ({
		name,
		in: "path",
		required: true,
		schema: { type: "string" },
		description:
			name === "orgSlug"
				? "The organization's slug, from `GET /me`."
				: "The row's id.",
		example: name === "orgSlug" ? orgSlug : undefined,
	}));

const operation = (op: Operation, orgSlug: string | undefined) => {
	const responses: Responses = {};
	if (op.response) {
		const body = ref(op.response);
		responses["200"] = {
			description: "OK",
			content: {
				"application/json": {
					schema: op.list ? { type: "array", items: body } : body,
				},
			},
		};
	} else {
		responses["204"] = { description: "No content" };
	}
	if (op.auth !== false) {
		responses["401"] = errorResponse("No token, or a bad or expired one.");
		responses["429"] = errorResponse("Too many requests.");
	}
	// Every write but revoking the token itself, which `userApiRoute` lets a
	// read-only token do (see `serve` in server/api-route.ts).
	if (op.method !== "get" && op.auth !== false && op.path !== "/session") {
		responses["403"] = errorResponse("Not allowed, or a read-only API token.");
	}
	if (op.body || op.query) {
		responses["422"] = errorResponse("The input is not valid.");
	}

	return {
		operationId: op.operationId,
		summary: op.summary,
		description: op.description,
		tags: [op.tag],
		security: op.auth === false ? [] : undefined,
		parameters: [
			...pathParameters(op.path, orgSlug),
			...(op.query ? queryParameters(op.query) : []),
		],
		requestBody: op.body
			? {
					required: true,
					content: { "application/json": { schema: ref(op.body) } },
				}
			: undefined,
		responses,
	};
};

/**
 * The document.
 *
 * `orgSlug` is what `/api-docs` asks for when the reader is signed in. It
 * becomes the example of every `orgSlug` path parameter, which Scalar fills
 * in, and it adds the `session` scheme: the reader's own browser session,
 * picked in Scalar's Authentication menu beside the bearer token. The scheme
 * is a header only that page sends (`SESSION_REQUEST_HEADER`); what makes it
 * safe is `provesSameOrigin` in `server/api-route.ts`. The plain document
 * leaves it out, because no other client can use it.
 */
export const buildOpenApiDocument = ({
	orgSlug,
}: { orgSlug?: string } = {}) => {
	const paths: {
		[path: string]: Partial<Record<Method, ReturnType<typeof operation>>>;
	} = {};
	for (const op of OPERATIONS) {
		paths[op.path] ??= {};
		paths[op.path][op.method] = operation(op, orgSlug);
	}
	return {
		openapi: "3.1.0",
		info: { title: "Farmer API", version: "1", description: INTRO },
		servers: [{ url: "/api/v1" }],
		security: orgSlug ? [{ session: [] }, { bearer: [] }] : [{ bearer: [] }],
		tags: Object.entries(TAG_TEXT).map(([name, description]) => ({
			name,
			description,
		})),
		paths,
		components: {
			securitySchemes: {
				// Undefined drops out of the JSON, so the plain document has no key.
				session: orgSlug
					? {
							type: "apiKey",
							in: "header",
							name: SESSION_REQUEST_HEADER,
							description:
								"Your browser session, on this page only. Requests act as you and change your real data.",
						}
					: undefined,
				bearer: {
					type: "http",
					scheme: "bearer",
					description: `An API token from [Preferences → API tokens](${API_TOKENS_PAGE}) (recommended), or the \`access_token\` from the device flow.`,
				},
			},
			schemas: componentSchemas(),
		},
	};
};
