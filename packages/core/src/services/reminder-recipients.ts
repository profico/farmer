// Who gets which reminder on a given day, and what it says.
//
// One definition, two callers: the jobs (`jobs/log-reminders.ts`,
// `jobs/slack-reminders.ts`), which send it, and the settings page's "Who gets
// this today" (`reminderSettingsService.preview`), which only shows it. The
// preview used to be impossible to write honestly — the rules were inline in
// the two job loops — and a preview that re-states the rules is a preview that
// drifts from them. So the jobs send exactly the `event` this module built, and
// the preview shows exactly the same list.
//
// Deliberately NOT here: the delivery gates (a member? archived? signed in
// ever? opted out?). Those belong to `notify.ts`, which applies them to every
// send whoever the caller is; the preview asks `deliveryBlocks` for the same
// answer. And not the "already sent today" claims, which are each job's own.
//
// Non-aggregate, like `ledger.ts`: it lives in services/ rather than jobs/ so
// the reminder settings service can import it without a cycle through the
// jobs barrel.

import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "../db";
import { member, user } from "../db/schema/auth";
import { timeEntry } from "../db/schema/domain";
import {
	addDaysToKey,
	endOfMonthKey,
	formatDuration,
	weekdayInTz,
} from "../lib/time";
import { dayDurationSeconds, dayForWeekday } from "../lib/working-day";
import type {
	ReminderKind,
	ReminderSettings,
} from "../schema/reminder-settings";
import {
	type BehindPaceRow,
	complianceService,
	type NoEntriesRow,
} from "./compliance.service";
import { holidaysService } from "./holidays.service";
import type { NotifyEvent } from "./notify";
import type { Ctx } from "./types";
import { workingHoursService } from "./working-hours.service";

/** One person a reminder goes to, and the message it carries. `reason` is the
 *  short "why them" the preview shows beside the name. */
export type ReminderRecipient = {
	userId: string;
	name: string;
	email: string;
	reason: string;
	event: NotifyEvent;
};

/** The moment a reminder is judged at.
 *
 *  `timeKey` is the org-local "HH:mm" the send times are compared with; null
 *  ignores them, which is what the preview wants — "who gets this today" is a
 *  question about the day, and at 08:00 the honest answer to "who gets the
 *  09:00 nudge" is not "nobody". `now` is the instant the compliance views
 *  measure the month against. */
export type ReminderMoment = {
	dayKey: string;
	timeKey: string | null;
	tz: string;
	now: Date;
	/** The org's slug, for the log reminder's deep link. */
	slug: string;
};

export type ComplianceDashboard = {
	noEntries: NoEntriesRow[];
	behindPace: BehindPaceRow[];
};

/** The compliance views, loaded at most once however many kinds need them. The
 *  nudge, the month-end "only behind pace" and the digest all read the same
 *  lists, and they are the expensive part of a tick. */
export const dashboardLoader = (
	ctx: Ctx,
	settings: ReminderSettings,
	now: Date,
): (() => Promise<ComplianceDashboard>) => {
	let loaded: Promise<ComplianceDashboard> | undefined;
	return () => {
		loaded ??= complianceService.dashboardForReminderJob(
			ctx,
			{ now },
			settings.nudgeBehindPacePct / 100,
		);
		return loaded;
	};
};

const weekdayOf = (dayKey: string) =>
	new Date(`${dayKey}T00:00:00Z`).getUTCDay();

const plural = (count: number, one: string, many: string) =>
	`${String(count)} ${count === 1 ? one : many}`;

/** Is `dayKey` exactly `daysBefore` ORG working days (Mon–Fri minus holidays)
 *  before the last working day of its month? 0 asks for the last working day
 *  itself.
 *
 *  Both halves matter. It used to ask only whether any LATER day in the month
 *  was a working day, which is true of every trailing weekend day too — so a
 *  month ending on a Sunday sent the month-end DM on the Friday, again on the
 *  Saturday and again on the Sunday. The `slack_reminder_log` claim is keyed on
 *  the day, so three different days meant three different claims and the
 *  idempotency guard never saw them as duplicates. Counting the working days
 *  after it keeps that fixed for every N: only a working day can be the day. */
export const isMonthEndDay = async (
	ctx: Ctx,
	dayKey: string,
	daysBefore: number,
): Promise<boolean> => {
	const month = dayKey.slice(0, 7);
	// To the end of the month rather than a fixed lookahead: the answer depends
	// on every remaining day, not the next ten.
	const holidays = await holidaysService.holidaySetForRange(
		ctx,
		dayKey,
		endOfMonthKey(dayKey),
	);
	const isWorkingDay = (key: string) => {
		if (holidays.has(key)) return false;
		const weekday = weekdayOf(key);
		return weekday !== 0 && weekday !== 6;
	};

	if (!isWorkingDay(dayKey)) return false;

	let workingDaysAfter = 0;
	for (
		let cursor = addDaysToKey(dayKey, 1);
		cursor.slice(0, 7) === month;
		cursor = addDaysToKey(cursor, 1)
	) {
		if (isWorkingDay(cursor)) workingDaysAfter++;
		if (workingDaysAfter > daysBefore) return false;
	}
	return workingDaysAfter === daysBefore;
};

/** Why `kind` does not go out on `dayKey` at all, or null when it does. The
 *  day only — the time of day is `sendTimeReached`, and each person's own
 *  schedule is the log reminder's selection. */
export const reminderDayCheck = async (
	ctx: Ctx,
	settings: ReminderSettings,
	kind: ReminderKind,
	dayKey: string,
): Promise<string | null> => {
	switch (kind) {
		case "log-reminder":
			return settings.logEnabled ? null : "The log reminder is off.";
		case "compliance-nudge":
			if (!settings.nudgeEnabled) return "The Slack nudge is off.";
			if (!settings.nudgeNoEntries && !settings.nudgeBehindPace) {
				return "Neither nudge condition is on.";
			}
			return settings.nudgeWeekdays.includes(weekdayOf(dayKey))
				? null
				: "This day is not a nudge day.";
		case "month-end":
			if (!settings.monthEndEnabled) return "The month-end reminder is off.";
			if (await isMonthEndDay(ctx, dayKey, settings.monthEndDaysBefore)) {
				return null;
			}
			return settings.monthEndDaysBefore === 0
				? "This day is not the last working day of the month."
				: `This day is not ${plural(settings.monthEndDaysBefore, "working day", "working days")} before the last working day of the month.`;
		case "admin-digest":
			if (!settings.digestEnabled) return "The admin digest is off.";
			return weekdayOf(dayKey) === settings.digestWeekday
				? null
				: "This day is not the digest day.";
	}
};

/** The configured send time of `kind`, or null for the log reminder at the end
 *  of each person's own workday. */
export const sendTimeOf = (
	settings: ReminderSettings,
	kind: ReminderKind,
): string | null => {
	switch (kind) {
		case "log-reminder":
			return settings.logMode === "fixed" ? settings.logTime : null;
		case "compliance-nudge":
			return settings.nudgeTime;
		case "month-end":
			return settings.monthEndTime;
		case "admin-digest":
			return settings.digestTime;
	}
};

/** Has the org-local `timeKey` reached the send time of `kind`? Always true for
 *  an end-of-workday log reminder, whose time is per person and is checked in
 *  the selection. Both sides are "HH:mm", so the string order is the time
 *  order. */
export const sendTimeReached = (
	settings: ReminderSettings,
	kind: ReminderKind,
	timeKey: string,
): boolean => {
	const time = sendTimeOf(settings, kind);
	return time === null || timeKey >= time;
};

/** The log reminder, for every member of the org (or `onlyUserIds`) at once:
 *  one query for each fact rather than four for each person. */
const logReminders = async (
	ctx: Ctx,
	settings: ReminderSettings,
	moment: ReminderMoment,
	onlyUserIds: string[] | undefined,
): Promise<ReminderRecipient[]> => {
	const { dayKey, timeKey, tz } = moment;

	// Not on an org holiday — a day off for everyone, so nobody is asked.
	const holidays = await holidaysService.holidaySetForRange(
		ctx,
		dayKey,
		dayKey,
	);
	if (holidays.has(dayKey)) return [];

	const people = await db
		.select({ userId: member.userId, name: user.name, email: user.email })
		.from(member)
		.innerJoin(user, eq(user.id, member.userId))
		.where(
			onlyUserIds
				? and(
						eq(member.organizationId, ctx.organizationId),
						inArray(member.userId, onlyUserIds),
					)
				: eq(member.organizationId, ctx.organizationId),
		);
	if (people.length === 0) return [];
	const userIds = people.map((p) => p.userId);

	// Everything logged that day, absence and fill blocks included. Vacation and
	// Sick Leave are ordinary entries against the two built-in absence tasks, so
	// a day off accounts for itself; a fill block means the person deliberately
	// accounted for the rest of the day.
	const [schedules, logged] = await Promise.all([
		workingHoursService.listForOrg(ctx, userIds),
		db
			.select({
				userId: timeEntry.userId,
				seconds: sql<number>`sum(${timeEntry.durationSeconds})`.mapWith(Number),
			})
			.from(timeEntry)
			.where(
				and(
					eq(timeEntry.organizationId, ctx.organizationId),
					inArray(timeEntry.userId, userIds),
					eq(timeEntry.date, dayKey),
				),
			)
			.groupBy(timeEntry.userId),
	]);
	const loggedByUser = new Map(logged.map((r) => [r.userId, r.seconds]));
	const weekday = weekdayInTz(dayKey, tz);

	const recipients: ReminderRecipient[] = [];
	for (const person of people) {
		// A scheduled working day with a defined end time.
		const day = dayForWeekday(schedules.get(person.userId) ?? [], weekday);
		const expectedSeconds = day ? dayDurationSeconds(day) : 0;
		if (expectedSeconds <= 0 || !day?.endTime) continue;

		// Only once the send time has come: the end of THEIR workday, or the
		// org's fixed time.
		if (timeKey !== null) {
			const sendAt =
				settings.logMode === "fixed" ? settings.logTime : day.endTime;
			if (timeKey < sendAt) continue;
		}

		const loggedSeconds = loggedByUser.get(person.userId) ?? 0;
		// Below the configured share of the day's target. 100% is "anything
		// short of the full day", which is what the job always asked.
		if (loggedSeconds * 100 >= expectedSeconds * settings.logBelowPct) continue;

		recipients.push({
			userId: person.userId,
			name: person.name,
			email: person.email,
			reason: `Logged ${formatDuration(loggedSeconds)} of ${formatDuration(expectedSeconds)}`,
			event: {
				kind: "log-reminder",
				title: "Don't forget to log your hours",
				body: `You've logged ${formatDuration(loggedSeconds)} of ${formatDuration(
					expectedSeconds,
				)} expected today.`,
				url: `/${moment.slug}/time`,
				tag: `log-reminder-${dayKey}`,
			},
		});
	}
	return recipients;
};

const nudges = (
	settings: ReminderSettings,
	{ noEntries, behindPace }: ComplianceDashboard,
): ReminderRecipient[] => {
	const types = new Set<string>(settings.nudgeMemberTypes);
	// One DM per person even when they're on both lists — the message leads with
	// whichever problem is worse, so "no entries" overwrites "behind pace".
	const byUser = new Map<string, ReminderRecipient>();
	if (settings.nudgeBehindPace) {
		for (const row of behindPace) {
			if (!types.has(row.memberType)) continue;
			byUser.set(row.userId, {
				userId: row.userId,
				name: row.name,
				email: row.email,
				reason: `At ${String(row.pacePct)}% of pace`,
				event: {
					kind: "compliance-nudge",
					body: `You're at ${row.pacePct}% of your expected hours for the month so far — ${formatDuration(
						row.shortfallSeconds,
					)} short. A few minutes now beats reconstructing the month later.`,
				},
			});
		}
	}
	if (settings.nudgeNoEntries) {
		for (const row of noEntries) {
			if (!types.has(row.memberType)) continue;
			byUser.set(row.userId, {
				userId: row.userId,
				name: row.name,
				email: row.email,
				reason: `No entries for ${plural(row.workingDaysMissing, "working day", "working days")}`,
				event: {
					kind: "compliance-nudge",
					body: row.lastEntryDate
						? `You haven't logged anything since ${row.lastEntryDate} — that's ${row.workingDaysMissing} working ${
								row.workingDaysMissing === 1 ? "day" : "days"
							}. Worth filling in while you still remember it.`
						: "You haven't logged any time yet. Worth starting today — reconstructing a month from memory is the part everyone hates.",
				},
			});
		}
	}
	return [...byUser.values()];
};

const monthEndText = (daysBefore: number) =>
	daysBefore === 0
		? "Today is the last working day of the month. Anything still unlogged needs to go in before the monthly close starts tomorrow."
		: `The last working day of the month is ${
				daysBefore === 1
					? "tomorrow"
					: `${String(daysBefore)} working days away`
			}. Anything still unlogged needs to go in before the monthly close starts.`;

const monthEnd = async (
	ctx: Ctx,
	settings: ReminderSettings,
	moment: ReminderMoment,
	dashboard: () => Promise<ComplianceDashboard>,
): Promise<ReminderRecipient[]> => {
	// The COHORT — no overhead, no archived — and not every member of the org,
	// which is what this once selected. Everyone in it by default, not just the
	// laggards: the close is coming, and "I thought I was fine" is exactly the
	// failure this prevents. `monthEndOnlyBehind` narrows it for an org that
	// finds that too loud.
	const cohort = await complianceService.cohortForReminderJob(ctx, {
		year: Number(moment.dayKey.slice(0, 4)),
		month: Number(moment.dayKey.slice(5, 7)),
	});
	const types = new Set<string>(settings.monthEndMemberTypes);
	const behind = settings.monthEndOnlyBehind
		? new Map((await dashboard()).behindPace.map((r) => [r.userId, r]))
		: null;

	const body = monthEndText(settings.monthEndDaysBefore);
	const recipients: ReminderRecipient[] = [];
	for (const person of cohort) {
		if (!types.has(person.memberType.type)) continue;
		const pace = behind?.get(person.userId);
		if (behind && !pace) continue;
		recipients.push({
			userId: person.userId,
			name: person.name,
			email: person.email,
			reason: pace ? `At ${String(pace.pacePct)}% of pace` : "In the cohort",
			event: { kind: "month-end", body },
		});
	}
	return recipients;
};

const digest = async (
	ctx: Ctx,
	settings: ReminderSettings,
	dashboard: () => Promise<ComplianceDashboard>,
): Promise<ReminderRecipient[]> => {
	const [{ noEntries, behindPace }, admins] = await Promise.all([
		dashboard(),
		db
			.select({
				userId: member.userId,
				role: member.role,
				name: user.name,
				email: user.email,
			})
			.from(member)
			.innerJoin(user, eq(user.id, member.userId))
			.where(eq(member.organizationId, ctx.organizationId)),
	]);
	const body = [
		"*Time tracking this week*",
		`• ${noEntries.length} ${noEntries.length === 1 ? "person has" : "people have"} logged nothing in the last ${settings.complianceMissingDays} working days`,
		`• ${behindPace.length} ${behindPace.length === 1 ? "person is" : "people are"} behind pace for the month`,
		...noEntries
			.slice(0, 10)
			.map(
				(r) =>
					`    ${r.name} — ${r.workingDaysMissing} working ${
						r.workingDaysMissing === 1 ? "day" : "days"
					} missing`,
			),
	].join("\n");

	return admins
		.filter((a) => a.role === "owner" || a.role === "admin")
		.map((a) => ({
			userId: a.userId,
			name: a.name,
			email: a.email,
			reason: a.role === "owner" ? "Owner" : "Admin",
			event: { kind: "admin-digest", body },
		}));
};

/**
 * Who gets `kind` at `moment`, and the message each one gets — BEFORE the
 * delivery gates in `notify.ts`. The caller has already asked
 * `reminderDayCheck`; this does not ask it again.
 *
 * `onlyUserIds` narrows the log reminder to people not yet reminded that day;
 * the Slack kinds leave that to their claim rows.
 */
export const reminderRecipients = async (
	ctx: Ctx,
	settings: ReminderSettings,
	kind: ReminderKind,
	moment: ReminderMoment,
	dashboard: () => Promise<ComplianceDashboard>,
	onlyUserIds?: string[],
): Promise<ReminderRecipient[]> => {
	switch (kind) {
		case "log-reminder":
			return logReminders(ctx, settings, moment, onlyUserIds);
		case "compliance-nudge":
			return nudges(settings, await dashboard());
		case "month-end":
			return monthEnd(ctx, settings, moment, dashboard);
		case "admin-digest":
			return digest(ctx, settings, dashboard);
	}
};
