/**
 * The answers of the routes for the member's own screens. The rules of
 * `schemas.ts` apply: an unknown field is dropped, and a value from an open
 * set is read as a string.
 */

import { z } from "zod";

import type { Expect, Parses } from "./contract";
import type { components } from "./openapi.gen";

type Schemas = components["schemas"];

export const fileResultSchema = z.object({
	filed: z.number(),
	failed: z.number(),
	firstError: z.string().nullable(),
});
export type FileResult = z.output<typeof fileResultSchema>;

export const copyResultSchema = z.object({
	copied: z.number(),
	skipped: z.number(),
	/**
	 * The days a week copy left alone because they would pass 24 hours. Always
	 * empty for a day copy.
	 */
	blockedDays: z.array(z.string()),
});
export type CopyResult = z.output<typeof copyResultSchema>;

export const absenceEntrySchema = z.object({
	id: z.string(),
	/** A day, yyyy-MM-dd. */
	date: z.string(),
	task: z.object({
		id: z.string(),
		name: z.string(),
	}),
	description: z.string(),
	durationSeconds: z.number(),
});
export type AbsenceEntry = z.output<typeof absenceEntrySchema>;

export const absenceResultSchema = z.object({
	booked: z.array(
		z.object({
			/** A day, yyyy-MM-dd. */
			date: z.string(),
			durationSeconds: z.number(),
		}),
	),
	/** A weekend, a public holiday or a day already off. */
	skipped: z.array(
		z.object({
			/** A day, yyyy-MM-dd. */
			date: z.string(),
			reason: z.string(),
		}),
	),
});
export type AbsenceResult = z.output<typeof absenceResultSchema>;

export const homeSchema = z.object({
	/** A day, yyyy-MM-dd. */
	today: z.string(),
	/** A day, yyyy-MM-dd. */
	from: z.string(),
	/** A day, yyyy-MM-dd. */
	to: z.string(),
	/** What one working day is worth for the person this month. */
	daySeconds: z.number(),
	days: z.array(
		z.object({
			/** A day, yyyy-MM-dd. */
			date: z.string(),
			seconds: z.number(),
			holiday: z.string().nullable(),
			/**
			 * Null for a weekend, a holiday or a day after today. `covered` is a short
			 * day that the rest of the week made up for.
			 */
			mark: z.string().nullable(),
		}),
	),
});
export type Home = z.output<typeof homeSchema>;

export const timerSettingsSchema = z.object({
	/** A timer that runs longer than this is dropped and logs nothing. */
	maxSeconds: z.number(),
});
export type TimerSettings = z.output<typeof timerSettingsSchema>;

export const notificationSettingsSchema = z.object({
	/** Reminders to log time, by push and by Slack. */
	logReminders: z.boolean(),
	/** `app`: the Slack kinds go to the phone when it allows notifications,
	 *  else to Slack. `slack`: always to Slack. */
	remindersChannel: z.enum(["app", "slack"]),
});
export type NotificationSettings = z.output<typeof notificationSettingsSchema>;

export const hiddenTasksSchema = z.object({
	/** The tasks the person switched off. They only narrow the task picker. */
	taskIds: z.array(z.string()),
});
export type HiddenTasks = z.output<typeof hiddenTasksSchema>;

export const filingRuleSchema = z.object({
	id: z.string(),
	/** The meeting title the rule matches. */
	title: z.string(),
	/** The task the meeting arrives with. */
	task: z.object({
		id: z.string(),
		name: z.string(),
	}),
	/** The task the meeting is filed under. Null keeps its own. */
	targetTask: z
		.object({
			id: z.string(),
			name: z.string(),
		})
		.nullable(),
	project: z.object({
		id: z.string(),
		name: z.string(),
		code: z.string().nullable(),
	}),
	/** An instant, ISO 8601 in UTC. */
	createdAt: z.string(),
});
export type FilingRule = z.output<typeof filingRuleSchema>;

export const workingHoursDaySchema = z.object({
	/** 0 is Sunday. */
	dayOfWeek: z.number(),
	enabled: z.boolean(),
	/** HH:mm. */
	startTime: z.string().nullable(),
	/** HH:mm. */
	endTime: z.string().nullable(),
});
export type WorkingHoursDay = z.output<typeof workingHoursDaySchema>;

export const recurringBlockSchema = z.object({
	id: z.string(),
	task: z.object({
		id: z.string(),
		name: z.string(),
	}),
	project: z
		.object({
			id: z.string(),
			name: z.string(),
			code: z.string().nullable(),
		})
		.nullable(),
	description: z.string(),
	/** 0 is Sunday. */
	daysOfWeek: z.array(z.number()),
	durationSeconds: z.number(),
	/** A day, yyyy-MM-dd. */
	effectiveFrom: z.string().nullable(),
	/** A day, yyyy-MM-dd. */
	effectiveUntil: z.string().nullable(),
	/** False while the rule is paused. */
	active: z.boolean(),
});
export type RecurringBlock = z.output<typeof recurringBlockSchema>;

export const holidaySchema = z.object({
	/** A day, yyyy-MM-dd. */
	date: z.string(),
	name: z.string(),
	/** An admin made the day a working day. */
	disabled: z.boolean(),
});
export type Holiday = z.output<typeof holidaySchema>;

export const holidayDaySchema = z.object({
	/** A day, yyyy-MM-dd. */
	date: z.string(),
	name: z.string(),
});
export type HolidayDay = z.output<typeof holidayDaySchema>;

export const integrationsSchema = z.object({
	github: z.object({
		connected: z.boolean(),
		login: z.string().nullable(),
		/** GitHub did not answer. The account is still linked. */
		unreachable: z.boolean(),
		/**
		 * GitHub refuses the stored grant. Only a new connection in the web app
		 * fixes it.
		 */
		needsReconnect: z.boolean(),
	}),
	googleCalendar: z.object({
		connected: z.boolean(),
		email: z.string().nullable(),
		/** Google did not answer. The account is still linked. */
		unreachable: z.boolean(),
	}),
	settings: z.object({
		googleAutoSyncMeetings: z.boolean(),
		githubAutoLoadCommits: z.boolean(),
		githubSyncCommitsAsWorkTime: z.boolean(),
		/** When the meeting sync went on: the first day it may write to. */
		googleAutoSyncMeetingsSince: z.string().nullable(),
		/** When the commit sync went on: the first day it may write to. */
		githubSyncCommitsAsWorkTimeSince: z.string().nullable(),
	}),
});
export type Integrations = z.output<typeof integrationsSchema>;

export const integrationSettingsSchema = z.object({
	googleAutoSyncMeetings: z.boolean(),
	githubAutoLoadCommits: z.boolean(),
	githubSyncCommitsAsWorkTime: z.boolean(),
	/** When the meeting sync went on: the first day it may write to. */
	googleAutoSyncMeetingsSince: z.string().nullable(),
	/** When the commit sync went on: the first day it may write to. */
	githubSyncCommitsAsWorkTimeSince: z.string().nullable(),
	/**
	 * A sync went on and its first pass finished during the save. False when it
	 * continues on the server.
	 */
	synced: z.boolean(),
});
export type IntegrationSettings = z.output<typeof integrationSettingsSchema>;

export const timeReportSchema = z.object({
	rows: z.array(
		z.object({
			id: z.string(),
			name: z.string(),
			secondsTotal: z.number(),
			/** The teammates tab only. Zero on the others. */
			timeOffSeconds: z.number(),
			/**
			 * Clients: projects with time. Projects: people with time. Teammates:
			 * projects.
			 */
			count: z.number(),
			clientName: z.string().nullable(),
			code: z.string().nullable(),
			archived: z.boolean(),
		}),
	),
	totalSeconds: z.number(),
	/**
	 * Worked time with no project, which the rows leave out. Only for an
	 * unfiltered report over the whole organization.
	 */
	unfiledSeconds: z.number(),
});
export type TimeReport = z.output<typeof timeReportSchema>;

export const timeReportDetailSchema = z.object({
	rows: z.array(
		z.object({
			id: z.string(),
			/** A day, yyyy-MM-dd. */
			date: z.string(),
			client: z.object({
				id: z.string(),
				name: z.string(),
			}),
			project: z.object({
				id: z.string(),
				name: z.string(),
				code: z.string().nullable(),
			}),
			task: z.object({
				id: z.string(),
				name: z.string(),
			}),
			description: z.string(),
			user: z.object({
				id: z.string(),
				name: z.string(),
			}),
			overtime: z.boolean(),
			durationSeconds: z.number(),
		}),
	),
	totalRows: z.number(),
	totalSeconds: z.number(),
	/** The rows stop at a cap. The two totals still count every matching entry. */
	truncated: z.boolean(),
});
export type TimeReportDetail = z.output<typeof timeReportDetailSchema>;

export const overtimeReportSchema = z.object({
	rows: z.array(
		z.object({
			userId: z.string(),
			name: z.string(),
			count: z.number(),
			seconds: z.number(),
			entries: z.array(
				z.object({
					id: z.string(),
					/** A day, yyyy-MM-dd. */
					date: z.string(),
					projectName: z.string(),
					projectCode: z.string().nullable(),
					taskName: z.string(),
					description: z.string(),
					durationSeconds: z.number(),
				}),
			),
		}),
	),
	totalSeconds: z.number(),
	totalEntries: z.number(),
});
export type OvertimeReport = z.output<typeof overtimeReportSchema>;

export const trackingReportSchema = z.object({
	year: z.number(),
	month: z.number(),
	/** The last day the figures cover. */
	asOf: z.string(),
	complete: z.boolean(),
	/** The month's hour fund. Null when none is set. */
	fundSeconds: z.number().nullable(),
	workingDaysInMonth: z.number(),
	workingDaysElapsed: z.number(),
	targetSeconds: z.number().nullable(),
	tolerancePct: z.number(),
	rows: z.array(
		z.object({
			userId: z.string(),
			name: z.string(),
			email: z.string(),
			memberType: z.string(),
			workSeconds: z.number(),
			timeOffSeconds: z.number(),
			totalSeconds: z.number(),
			targetSeconds: z.number().nullable(),
			monthTargetSeconds: z.number().nullable(),
			/** Total minus target. Negative is short. */
			deltaSeconds: z.number().nullable(),
			/** Null when no target applies to the person. */
			status: z.string().nullable(),
		}),
	),
});
export type TrackingReport = z.output<typeof trackingReportSchema>;

export const absenceReportSchema = z.object({
	workingDaySeconds: z.number(),
	/** One for each absence task. `key` is the system key, or the task id. */
	columns: z.array(
		z.object({
			key: z.string(),
			label: z.string(),
		}),
	),
	rows: z.array(
		z.object({
			userId: z.string(),
			name: z.string(),
			seconds: z.number(),
			/** Seconds for each column, by `key`. */
			byTask: z.record(z.string(), z.number()),
			entries: z.array(
				z.object({
					id: z.string(),
					/** A day, yyyy-MM-dd. */
					date: z.string(),
					taskKey: z.string(),
					taskName: z.string(),
					description: z.string(),
					durationSeconds: z.number(),
				}),
			),
		}),
	),
});
export type AbsenceReport = z.output<typeof absenceReportSchema>;

export const rewindSchema = z.object({
	year: z.number(),
	/** A day, yyyy-MM-dd. */
	asOf: z.string(),
	complete: z.boolean(),
	workedSeconds: z.number(),
	projectedWorkedSeconds: z.number().nullable(),
	previousYearWorkedSeconds: z.number().nullable(),
	/** A day, yyyy-MM-dd. */
	firstDay: z.string().nullable(),
	daysWorked: z.number(),
	longestStreak: z
		.object({
			days: z.number(),
			/** A day, yyyy-MM-dd. */
			from: z.string(),
			/** A day, yyyy-MM-dd. */
			to: z.string(),
		})
		.nullable(),
	busiestDay: z
		.object({
			/** A day, yyyy-MM-dd. */
			date: z.string(),
			seconds: z.number(),
		})
		.nullable(),
	months: z.array(
		z.object({
			month: z.number(),
			seconds: z.number(),
			projectedSeconds: z.number(),
		}),
	),
	/** Worked seconds by weekday. Index 0 is Sunday. */
	weekdays: z.array(z.number()),
	weekendDaysWorked: z.number(),
	overtimeSeconds: z.number(),
	projects: z.array(
		z.object({
			id: z.string(),
			name: z.string(),
			icon: z.string().nullable(),
			clientName: z.string(),
			seconds: z.number(),
		}),
	),
	projectCount: z.number(),
	clientCount: z.number(),
	tasks: z.array(
		z.object({
			id: z.string(),
			name: z.string(),
			seconds: z.number(),
		}),
	),
	groups: z.array(
		z.object({
			group: z.string(),
			seconds: z.number(),
		}),
	),
	meetingSeconds: z.number(),
	codeReviewSeconds: z.number(),
	timeOff: z.object({
		vacationDays: z.number(),
		sickDays: z.number(),
		otherDays: z.number(),
		aheadDays: z.number(),
	}),
	commits: z.number(),
	pullRequests: z.object({
		opened: z.number(),
		merged: z.number(),
		reviewed: z.number(),
	}),
	words: z.array(
		z.object({
			word: z.string(),
			count: z.number(),
		}),
	),
});
export type Rewind = z.output<typeof rewindSchema>;

export const projectDetailSchema = z.object({
	id: z.string(),
	name: z.string(),
	code: z.string().nullable(),
	status: z.string(),
	client: z.object({
		id: z.string(),
		name: z.string(),
	}),
	/** The role the caller holds on the project. */
	role: z.string().nullable(),
	/** `product_team`, `fixed_scope`, `hourly`, `maintenance` or `internal`. */
	type: z.string(),
	/** An emoji, or the path of an uploaded image. */
	icon: z.string().nullable(),
	/** Every member may log time on it without an assignment. */
	openToOrg: z.boolean(),
	/** Fixed scope only. Null also for a caller who may not see money. */
	budgetSeconds: z.number().nullable(),
	/** A decimal. Null for a caller who may not see money. */
	budgetAmount: z.string().nullable(),
	/** A decimal. Null for a caller who may not see money. */
	hourlyPrice: z.string().nullable(),
	stats: z.object({
		/**
		 * `own` when the caller may not see the project's hours: the figures are
		 * the caller's own.
		 */
		scope: z.string(),
		monthSeconds: z.number(),
		allTimeSeconds: z.number(),
		contributorCount: z.number(),
		/** At most five. Empty when `scope` is `own`. */
		contributors: z.array(
			z.object({
				id: z.string(),
				name: z.string(),
			}),
		),
	}),
});
export type ProjectDetail = z.output<typeof projectDetailSchema>;

export const syncResultSchema = z.object({
	/**
	 * The sync took longer than the request may stay open and continues on the
	 * server. The four lists are then empty.
	 */
	stillRunning: z.boolean(),
	ran: z.array(z.string()),
	skipped: z.array(z.string()),
	failed: z.array(z.string()),
	off: z.array(z.string()),
});
export type SyncResult = z.output<typeof syncResultSchema>;

export const projectOverviewSchema = z.object({
	allTimeSeconds: z.number(),
	entryCount: z.number(),
	/** The people who ever logged on it, not the team. */
	peopleCount: z.number(),
	/** A day, yyyy-MM-dd. */
	firstEntry: z.string().nullable(),
	/** A day, yyyy-MM-dd. */
	lastEntry: z.string().nullable(),
	overtimeSeconds: z.number(),
	monthSeconds: z.number(),
	monthPeople: z.number(),
});
export type ProjectOverview = z.output<typeof projectOverviewSchema>;

// Each answer the document describes must parse with the schema above.
export type MemberContractChecks = [
	Expect<Parses<Schemas["FileResult"], typeof fileResultSchema>>,
	Expect<Parses<Schemas["CopyResult"], typeof copyResultSchema>>,
	Expect<Parses<Schemas["AbsenceEntry"], typeof absenceEntrySchema>>,
	Expect<Parses<Schemas["AbsenceResult"], typeof absenceResultSchema>>,
	Expect<Parses<Schemas["Home"], typeof homeSchema>>,
	Expect<Parses<Schemas["TimerSettings"], typeof timerSettingsSchema>>,
	Expect<
		Parses<Schemas["NotificationSettings"], typeof notificationSettingsSchema>
	>,
	Expect<Parses<Schemas["HiddenTasks"], typeof hiddenTasksSchema>>,
	Expect<Parses<Schemas["FilingRule"], typeof filingRuleSchema>>,
	Expect<Parses<Schemas["WorkingHoursDay"], typeof workingHoursDaySchema>>,
	Expect<Parses<Schemas["RecurringBlock"], typeof recurringBlockSchema>>,
	Expect<Parses<Schemas["Holiday"], typeof holidaySchema>>,
	Expect<Parses<Schemas["HolidayDay"], typeof holidayDaySchema>>,
	Expect<Parses<Schemas["Integrations"], typeof integrationsSchema>>,
	Expect<
		Parses<Schemas["IntegrationSettings"], typeof integrationSettingsSchema>
	>,
	Expect<Parses<Schemas["TimeReport"], typeof timeReportSchema>>,
	Expect<Parses<Schemas["TimeReportDetail"], typeof timeReportDetailSchema>>,
	Expect<Parses<Schemas["OvertimeReport"], typeof overtimeReportSchema>>,
	Expect<Parses<Schemas["TrackingReport"], typeof trackingReportSchema>>,
	Expect<Parses<Schemas["AbsenceReport"], typeof absenceReportSchema>>,
	Expect<Parses<Schemas["Rewind"], typeof rewindSchema>>,
	Expect<Parses<Schemas["ProjectDetail"], typeof projectDetailSchema>>,
	Expect<Parses<Schemas["SyncResult"], typeof syncResultSchema>>,
	Expect<Parses<Schemas["ProjectOverview"], typeof projectOverviewSchema>>,
];
