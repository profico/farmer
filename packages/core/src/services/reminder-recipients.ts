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
import { slackEscape } from "../lib/slack-client";
import {
	addDaysToKey,
	dayKeyInTz,
	endOfMonthKey,
	formatDurationShort,
	weekdayInTz,
} from "../lib/time";
import { dayDurationSeconds, dayForWeekday } from "../lib/working-day";
import {
	REMINDER_EARLIEST_TIME,
	REMINDER_LATEST_TIME,
	type ReminderKind,
	type ReminderSettings,
} from "../schema/reminder-settings";
import { shownEmail } from "./claim-name";
import {
	complianceService,
	type TrackingReport,
	type TrackingRow,
} from "./compliance.service";
import { ctxTimezone } from "./context";
import { holidaysService } from "./holidays.service";
import type { NotifyEvent } from "./notify";
import { slackService } from "./slack.service";
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

export type ComplianceDashboard = TrackingReport;

/** The Tracking report for the month `now` is in, loaded at most once however
 *  many kinds need it. The nudge, the month-end "only behind" option and the
 *  digest all read the same verdicts, and it is the expensive part of a tick. */
export const dashboardLoader = (
	ctx: Ctx,
	_settings: ReminderSettings,
	now: Date,
): (() => Promise<ComplianceDashboard>) => {
	let loaded: Promise<ComplianceDashboard> | undefined;
	return () => {
		loaded ??= (async () => {
			const today = dayKeyInTz(now, await ctxTimezone(ctx));
			return complianceService.trackingForReminderJob(
				ctx,
				{ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) },
				{ now },
			);
		})();
		return loaded;
	};
};

/** The people the rule calls behind — the only ones a nudge is for. */
const behindRows = (report: TrackingReport): TrackingRow[] =>
	report.rows.filter((r) => r.status === "behind");

const weekdayOf = (dayKey: string) =>
	new Date(`${dayKey}T00:00:00Z`).getUTCDay();

const plural = (count: number, one: string, many: string) =>
	`${String(count)} ${count === 1 ? one : many}`;

/** A day key the way a person says it — "Aug 12" — with the year only when it
 *  is not the current one. */

/** How long somebody has logged nothing, from their last entry.
 *
 *  The date and never `workingDaysMissing`: that count stops at the edge of the
 *  compliance view's look-back window, so a person who had never logged read as
 *  "19 working days missing" one week and "29" the next — the window's size,
 *  not a fact about them. */

const short = formatDurationShort;

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
		case "compliance-nudge": {
			if (!settings.nudgeEnabled) return "The Slack nudge is off.";
			if (!settings.nudgeWeekdays.includes(weekdayOf(dayKey))) {
				return "This day is not a nudge day.";
			}
			// Never on a weekend or a public holiday: nobody is expected to log
			// anything on a day off, so nobody is chased about it either.
			const weekday = weekdayOf(dayKey);
			if (weekday === 0 || weekday === 6) return "This day is a weekend.";
			const holidays = await holidaysService.holidaySetForRange(
				ctx,
				dayKey,
				dayKey,
			);
			return holidays.has(dayKey) ? "This day is a public holiday." : null;
		}
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

/** Is the org-local `timeKey` inside the hours a reminder may go out in?
 *  Nothing goes out between 20:00 and 07:00 (docs/plans/reminder-settings.md
 *  §3). The settings schema keeps every configured time inside these bounds,
 *  but a configured time is only a floor: a tick at 23:30 is still "after
 *  09:00", and a person first due late (a reminder switched on, a claim not yet
 *  made) would be sent to then. The same bounds as the schema, so 20:00 itself
 *  may send. */
export const withinSendHours = (timeKey: string): boolean =>
	timeKey >= REMINDER_EARLIEST_TIME && timeKey <= REMINDER_LATEST_TIME;

/** Has the org-local `timeKey` reached the send time of `kind`, inside the
 *  send hours? For an end-of-workday log reminder the time is per person and
 *  is checked in the selection. Both sides are "HH:mm", so the string order is
 *  the time order. */
export const sendTimeReached = (
	settings: ReminderSettings,
	kind: ReminderKind,
	timeKey: string,
): boolean => {
	if (!withinSendHours(timeKey)) return false;
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
		.select({ userId: member.userId, name: user.name, email: shownEmail() })
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
		// org's fixed time — and never in the quiet hours. A workday that ends
		// after 20:00 is reminded at 20:00, the last moment one may go out:
		// waiting for its end sent the push at 22:00, and skipping it would
		// leave a late shift with no reminder at all.
		if (timeKey !== null) {
			if (!withinSendHours(timeKey)) continue;
			const sendAt =
				settings.logMode === "fixed"
					? settings.logTime
					: day.endTime > REMINDER_LATEST_TIME
						? REMINDER_LATEST_TIME
						: day.endTime;
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
			reason: `Logged ${short(loggedSeconds)} of ${short(expectedSeconds)}`,
			event: {
				kind: "log-reminder",
				title: "Don't forget to log your hours",
				body: `You've logged ${short(loggedSeconds)} of ${short(expectedSeconds)} expected today.`,
				url: `/${moment.slug}/time`,
				tag: `log-reminder-${dayKey}`,
			},
		});
	}
	return recipients;
};

const nudges = (
	settings: ReminderSettings,
	moment: ReminderMoment,
	report: ComplianceDashboard,
): ReminderRecipient[] => {
	const types = new Set<string>(settings.nudgeMemberTypes);
	// The Tracking rule's verdict, and nothing else: a person is nudged when
	// they are behind — below the target so far by more than the tolerance —
	// and the numbers in the message are the report's own.
	const recipients: ReminderRecipient[] = [];
	for (const row of behindRows(report)) {
		if (!types.has(row.memberType)) continue;
		if (row.targetSeconds == null) continue;
		const shortBy = row.targetSeconds - row.totalSeconds;
		const nothingYet = row.totalSeconds === 0;
		recipients.push({
			userId: row.userId,
			name: row.name,
			email: row.email,
			reason: nothingYet
				? "Nothing logged this month"
				: `Behind: ${short(row.totalSeconds)} of ${short(row.targetSeconds)}`,
			event: {
				kind: "compliance-nudge",
				...(nothingYet
					? {
							title: "No time logged yet this month",
							body: `${short(row.targetSeconds)} expected by today. Worth starting now — rebuilding a month from memory is the part everyone hates.`,
						}
					: {
							title: "You're behind on your hours this month",
							body: `You've logged ${short(row.totalSeconds)} of the ${short(
								row.targetSeconds,
							)} expected by today, ${short(shortBy)} short.`,
						}),
				url: `/${moment.slug}/time/month`,
				linkLabel: "Open this month",
			},
		});
	}
	return recipients;
};

const monthEndTitle = (daysBefore: number) =>
	daysBefore === 0
		? "Today is the last working day of the month"
		: daysBefore === 1
			? "Tomorrow is the last working day of the month"
			: `The last working day of the month is ${String(daysBefore)} working days away`;

const monthEndAsk = (daysBefore: number) =>
	`Anything still unlogged needs to go in before the month ends${
		daysBefore === 0 ? " tomorrow" : ""
	}.`;

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
	const [cohort, report] = await Promise.all([
		complianceService.cohortForReminderJob(ctx, {
			year: Number(moment.dayKey.slice(0, 4)),
			month: Number(moment.dayKey.slice(5, 7)),
		}),
		dashboard(),
	]);
	const types = new Set<string>(settings.monthEndMemberTypes);
	const byUser = new Map(report.rows.map((r) => [r.userId, r]));

	const title = monthEndTitle(settings.monthEndDaysBefore);
	const ask = monthEndAsk(settings.monthEndDaysBefore);
	const recipients: ReminderRecipient[] = [];
	for (const person of cohort) {
		if (!types.has(person.memberType.type)) continue;
		const row = byUser.get(person.userId);
		const behind = row?.status === "behind";
		if (settings.monthEndOnlyBehind && !behind) continue;
		// The person's own numbers when something is missing. On this day the
		// nudge stands down for everyone this message reaches (see
		// `reminderRecipients`), so this is the one that has to say it.
		const own =
			row && row.targetSeconds != null && row.status !== "on_track"
				? row.totalSeconds === 0
					? "You haven't logged any time this month yet."
					: `You've logged ${short(row.totalSeconds)} of the ${short(
							row.targetSeconds,
						)} expected so far.`
				: null;
		recipients.push({
			userId: person.userId,
			name: person.name,
			email: person.email,
			reason: behind
				? `Behind: ${short(row.totalSeconds)} of ${short(row.targetSeconds ?? 0)}`
				: row?.status === "slightly_behind"
					? "Slightly behind"
					: "In the cohort",
			event: {
				kind: "month-end",
				title,
				body: own ? `${own} ${ask}` : ask,
				url: `/${moment.slug}/time/month`,
				linkLabel: "Open this month",
			},
		});
	}
	return recipients;
};

/** How many names each list in the digest shows before "and N more". */
const DIGEST_LIST_LIMIT = 10;

type DigestPerson = { userId: string; name: string };

/** The digest's lines, spelled by `name` and `bold` — plain for the preview,
 *  mrkdwn with mentions for Slack. One function, so the two cannot drift. */
const digestLines = (
	_settings: ReminderSettings,
	_today: string,
	report: ComplianceDashboard,
	name: (person: DigestPerson) => string,
	bold: (text: string) => string,
): string[] => {
	const behind = behindRows(report);
	const slightly = report.rows.filter((r) => r.status === "slightly_behind");
	if (behind.length === 0 && slightly.length === 0) {
		// No fund means no target for anyone, which means no verdict for anyone —
		// not that everyone met one. Saying "on track" here read as an all-clear
		// for a month Tracking never actually judged.
		return report.fundSeconds == null
			? [
					"No hour fund is set for this month, so Tracking cannot judge anyone yet.",
					"Set one in Settings → Hour fund.",
				]
			: ["Everyone is on track."];
	}
	const more = (total: number) =>
		total > DIGEST_LIST_LIMIT
			? [`• and ${String(total - DIGEST_LIST_LIMIT)} more`]
			: [];
	const line = (r: TrackingRow) =>
		`• ${name(r)} — ${short(r.totalSeconds)} of ${short(r.targetSeconds ?? 0)} (${short(
			(r.targetSeconds ?? 0) - r.totalSeconds,
		)} short)`;
	const lines: string[] = [];
	if (behind.length > 0) {
		lines.push(
			`${bold(plural(behind.length, "person", "people"))} ${
				behind.length === 1 ? "is" : "are"
			} behind for the month:`,
			...behind.slice(0, DIGEST_LIST_LIMIT).map(line),
			...more(behind.length),
		);
	}
	if (slightly.length > 0) {
		if (lines.length > 0) lines.push("");
		lines.push(
			`${bold(plural(slightly.length, "person", "people"))} ${
				slightly.length === 1 ? "is" : "are"
			} slightly behind (within the ${String(report.tolerancePct)}% tolerance):`,
			...slightly.slice(0, DIGEST_LIST_LIMIT).map(line),
			...more(slightly.length),
		);
	}
	return lines;
};

const DIGEST_TITLE = "Time tracking this week";

const digest = async (
	ctx: Ctx,
	settings: ReminderSettings,
	moment: ReminderMoment,
	dashboard: () => Promise<ComplianceDashboard>,
): Promise<ReminderRecipient[]> => {
	const [compliance, admins] = await Promise.all([
		dashboard(),
		db
			.select({
				userId: member.userId,
				role: member.role,
				name: user.name,
				email: shownEmail(),
			})
			.from(member)
			.innerJoin(user, eq(user.id, member.userId))
			.where(eq(member.organizationId, ctx.organizationId)),
	]);

	// People are mentioned rather than only named, so an admin can click through
	// to the person. It does not ping them: the digest is a DM to the admin, and
	// Slack only notifies a mentioned person who is in the conversation. Anybody
	// the bot never matched to Slack keeps their plain name.
	const slackIds = await slackService.slackIdsFor(ctx.organizationId, [
		...new Set(
			compliance.rows
				.filter((r) => r.status === "behind" || r.status === "slightly_behind")
				.map((r) => r.userId),
		),
	]);
	const mention = (person: DigestPerson) => {
		const id = slackIds.get(person.userId);
		return id ? `<@${id}>` : slackEscape(person.name);
	};

	const body = digestLines(
		settings,
		moment.dayKey,
		compliance,
		(p) => p.name,
		(t) => t,
	).join("\n");
	const slack = [
		`*${DIGEST_TITLE}*`,
		...digestLines(
			settings,
			moment.dayKey,
			compliance,
			mention,
			(t) => `*${t}*`,
		),
	].join("\n");

	return admins
		.filter((a) => a.role === "owner" || a.role === "admin")
		.map((a) => ({
			userId: a.userId,
			name: a.name,
			email: a.email,
			reason: a.role === "owner" ? "Owner" : "Admin",
			event: {
				kind: "admin-digest",
				title: DIGEST_TITLE,
				body,
				slack,
				url: `/${moment.slug}/reports?tab=compliance`,
				linkLabel: "Open the Tracking report",
			},
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
		case "compliance-nudge": {
			const picked = nudges(settings, moment, await dashboard());
			// On a day the month-end reminder goes out, it carries the same
			// numbers, so the nudge stands down for everyone it reaches. Two DMs
			// about one timesheet within the hour is the nag this avoids. Asked
			// per person, not per day: a person the month-end reminder skips
			// (its own member types, "only behind") still gets the nudge.
			if (
				(await reminderDayCheck(ctx, settings, "month-end", moment.dayKey)) !==
				null
			) {
				return picked;
			}
			const monthEndIds = new Set(
				(await monthEnd(ctx, settings, moment, dashboard)).map((r) => r.userId),
			);
			return picked.filter((r) => !monthEndIds.has(r.userId));
		}
		case "month-end":
			return monthEnd(ctx, settings, moment, dashboard);
		case "admin-digest":
			return digest(ctx, settings, moment, dashboard);
	}
};
