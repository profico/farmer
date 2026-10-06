/**
 * The answers of `/api/v1`, parsed at the boundary.
 *
 * A store build outlives the server it was built against (ADR 0005), so these
 * schemas are lenient on purpose: an unknown field is dropped, and a value
 * from an open set (a role, a status) is read as a string, so a newer server
 * cannot blank a screen. The bottom of the file checks each schema against
 * the types made from the server's own OpenAPI document (`openapi.json`,
 * `bun run generate`): every answer the server describes must parse here.
 */

import { z } from "zod";

import type { Expect, Parses } from "./contract";
import type { components } from "./openapi.gen";

const dayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** `GET /meta`. */
export const metaSchema = z.object({
	app: z.literal("farmer"),
	cliEnabled: z.boolean(),
	minCliVersion: z.string(),
	apiVersion: z.number().int().positive(),
	minMobileVersion: z.string(),
	/** The provider buttons, in the order of the login page. `kind` is an
	 *  open set: a client draws a kind it does not know as an OpenID Connect
	 *  source. */
	signInMethods: z.array(
		z.object({ id: z.string(), name: z.string(), kind: z.string() }),
	),
	/** True when the server offers an email and password form. */
	passwordSignIn: z.boolean(),
	/** The server sends native push through this relay. */
	pushRelay: z.object({
		enabled: z.boolean(),
		url: z.string().nullable(),
	}),
	/** The server stores images (`uploadImage`). */
	uploadsEnabled: z.boolean(),
	/** A person may make a workspace (`createOrganization`). False in
	 *  single-org mode. Absent before API version 3: read it as false. */
	organizationCreation: z.boolean().optional(),
	/** The provider sign-in ends in a one-time code that
	 *  `POST /api/auth/mobile/exchange` turns into the session. Absent on a
	 *  server from before the exchange: read it as false. */
	signInExchange: z.boolean().optional(),
});
export type Meta = z.output<typeof metaSchema>;
export type SignInMethod = Meta["signInMethods"][number];

export const meSchema = z.object({
	user: z.object({ id: z.string(), name: z.string(), email: z.string() }),
	organizations: z.array(z.object({ slug: z.string(), name: z.string() })),
});
export type Me = z.output<typeof meSchema>;
export type Workspace = Me["organizations"][number];

/** What the person may do in a workspace. */
export const capabilitiesSchema = z.object({
	isAdmin: z.boolean(),
	/** Admin, or a PM or Team Lead on any project. */
	canManageClients: z.boolean(),
	/** Admin, or a PM or Team Lead on any project. */
	canManageProjects: z.boolean(),
	/** The person has people on a Team Lead list. */
	leadsPeople: z.boolean(),
	/** Reports for everybody, not only for the person's own scope. */
	canSeeAllReports: z.boolean(),
});
export type Capabilities = z.output<typeof capabilitiesSchema>;

export const NO_CAPABILITIES: Capabilities = {
	isAdmin: false,
	canManageClients: false,
	canManageProjects: false,
	leadsPeople: false,
	canSeeAllReports: false,
};

export const whoamiSchema = z.object({
	userId: z.string(),
	name: z.string().nullable(),
	email: z.string().nullable(),
	organization: z.object({ slug: z.string(), name: z.string() }),
	orgRole: z.string().nullable(),
	isAdmin: z.boolean(),
	capabilities: capabilitiesSchema.default(NO_CAPABILITIES),
	timezone: z.string(),
	today: dayKey,
	weekStartsOn: z.number().int().min(0).max(6),
	workingDays: z.array(
		z.object({
			dayOfWeek: z.number().int(),
			startTime: z.string(),
			endTime: z.string(),
		}),
	),
	projects: z.array(
		z.object({ id: z.string(), name: z.string(), role: z.string().nullable() }),
	),
});
export type Whoami = z.output<typeof whoamiSchema>;

const clientRef = z.object({ id: z.string(), name: z.string() });

/** The calendar event of a synced meeting changed after the person edited
 *  the entry. API version 3. */
export const calendarChangeSchema = z.object({
	/** An instant, ISO 8601. */
	changedAt: z.string(),
	/** The values the sync wrote before the person's edit. */
	from: z.object({
		date: z.string().optional(),
		durationSeconds: z.number().optional(),
		description: z.string().optional(),
	}),
	/** What the calendar says now, or null when the event is gone. */
	calendar: z
		.object({ date: z.string(), durationSeconds: z.number() })
		.nullable(),
});
export type CalendarChange = z.output<typeof calendarChangeSchema>;

export const timeEntrySchema = z.object({
	id: z.string(),
	date: dayKey,
	durationSeconds: z.number(),
	description: z.string(),
	overtime: z.boolean(),
	fillsDay: z.boolean(),
	synced: z.boolean(),
	commitCount: z.number(),
	task: z.object({ id: z.string(), name: z.string(), isAbsence: z.boolean() }),
	project: z
		.object({
			id: z.string(),
			name: z.string(),
			code: z.string().nullable(),
			client: clientRef,
		})
		.nullable(),
	/** Null when there is nothing to choose. Absent on a server from before
	 *  API version 3. */
	calendarChange: calendarChangeSchema.nullable().optional(),
});
export type TimeEntry = z.output<typeof timeEntrySchema>;

export const unfiledEntrySchema = z.object({
	id: z.string(),
	date: dayKey,
	durationSeconds: z.number(),
	description: z.string(),
	task: z.object({ id: z.string(), name: z.string() }),
	meetingUrl: z.string().nullable(),
});
export type UnfiledEntry = z.output<typeof unfiledEntrySchema>;

export const deletedSchema = z.object({ id: z.string() });

export const projectSchema = z.object({
	id: z.string(),
	name: z.string(),
	code: z.string().nullable(),
	status: z.string(),
	client: clientRef,
	role: z.string().nullable(),
	/** The emoji or the path of the uploaded image (`/api/files/...`).
	 *  Absent on a server from before API version 2. */
	icon: z.string().nullable().optional(),
});
export type Project = z.output<typeof projectSchema>;

export const taskSchema = z.object({
	id: z.string(),
	name: z.string(),
	group: z.string(),
	isAbsence: z.boolean(),
	systemKey: z.string().nullable(),
});
export type Task = z.output<typeof taskSchema>;

export const taskListSchema = z.object({
	tasks: z.array(taskSchema),
	absenceTasks: z.array(taskSchema),
});
export type TaskList = z.output<typeof taskListSchema>;

export const periodSchema = z.object({
	from: dayKey,
	to: dayKey,
	workingDays: z.number(),
	workingDaysElapsed: z.number(),
	targetSeconds: z.number().nullable(),
	targetSoFarSeconds: z.number().nullable(),
	/** The working days and the goal through the end of today. */
	workingDaysThroughToday: z.number(),
	targetThroughTodaySeconds: z.number().nullable(),
	workSeconds: z.number(),
	timeOffSeconds: z.number(),
	totalSeconds: z.number(),
	totalSoFarSeconds: z.number(),
	/** `on_track`, `slightly_behind` or `behind` today. */
	status: z.string().nullable(),
});
export type Period = z.output<typeof periodSchema>;

export const trackingSchema = z.object({
	today: dayKey,
	daySeconds: z.number(),
	tolerancePct: z.number(),
	week: periodSchema,
	month: periodSchema,
});
export type Tracking = z.output<typeof trackingSchema>;

export const timerSchema = z.object({
	id: z.string(),
	startedAt: z.string(),
	droppedAt: z.string().nullable(),
	paused: z.boolean(),
	elapsedSeconds: z.number(),
	snappedSeconds: z.number(),
	serverNow: z.string(),
	description: z.string(),
	task: z.object({
		id: z.string(),
		name: z.string(),
		needsDescription: z.boolean(),
	}),
	project: z.object({ id: z.string(), name: z.string() }).nullable(),
	entry: z
		.object({ id: z.string(), date: dayKey, durationSeconds: z.number() })
		.nullable(),
	organization: z.object({
		slug: z.string(),
		name: z.string(),
		here: z.boolean(),
	}),
});
export type Timer = z.output<typeof timerSchema>;

export const timerStateSchema = z.object({ timer: timerSchema.nullable() });
export type TimerState = z.output<typeof timerStateSchema>;

/** The body of every error answer. `code` is an open set too. */
export const apiErrorSchema = z.object({
	error: z.string(),
	code: z.string(),
	issues: z
		.array(z.object({ path: z.string(), message: z.string() }))
		.optional(),
});

// The request bodies, from the server's document. The generated types read a
// field with a default as required, so those fields are optional here.
type Schemas = components["schemas"];

export type NewTimeEntry = Omit<
	Schemas["NewTimeEntry"],
	"overtime" | "fillsDay"
> & {
	overtime?: boolean;
	fillsDay?: boolean;
};

/** Each field replaces the stored one; `null` clears `projectId`. */
export type TimeEntryPatch = {
	date?: string;
	projectId?: string | null;
	taskId?: string;
	description?: string;
	durationSeconds?: number;
	overtime?: boolean;
};

export type StartTimer = Schemas["StartTimer"];

export type ConfirmTimer = Omit<Schemas["ConfirmTimer"], "overtime"> & {
	overtime?: boolean;
};

// Each answer the document describes must parse with the schema above.
export type ContractChecks = [
	Expect<Parses<Schemas["Meta"], typeof metaSchema>>,
	Expect<Parses<Schemas["Me"], typeof meSchema>>,
	Expect<Parses<Schemas["Whoami"], typeof whoamiSchema>>,
	Expect<Parses<Schemas["TimeEntry"], typeof timeEntrySchema>>,
	Expect<Parses<Schemas["UnfiledEntry"], typeof unfiledEntrySchema>>,
	Expect<Parses<Schemas["Deleted"], typeof deletedSchema>>,
	Expect<Parses<Schemas["Project"], typeof projectSchema>>,
	Expect<Parses<Schemas["TaskList"], typeof taskListSchema>>,
	Expect<Parses<Schemas["Tracking"], typeof trackingSchema>>,
	Expect<Parses<Schemas["TimerState"], typeof timerStateSchema>>,
	Expect<Parses<Schemas["Error"], typeof apiErrorSchema>>,
];
