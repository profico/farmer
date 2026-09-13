import { eq } from "drizzle-orm";

import { db } from "../db";
import { organization } from "../db/schema/auth";
import { reminderSettings } from "../db/schema/settings";
import { dayBoundsInTz } from "../lib/time";
import type { MemberTypeValue } from "../schema/members";
import type { NaggableMemberType } from "../schema/reminder-settings";
import {
	REMINDER_SETTINGS_DEFAULTS,
	type ReminderKind,
	type ReminderSettings,
	type UpdateReminderSettingsInput,
} from "../schema/reminder-settings";
import { ctxTimezone, requireAdmin } from "./context";
import { type DeliveryBlock, deliveryBlocks } from "./notify";
import {
	dashboardLoader,
	reminderDayCheck,
	reminderRecipients,
	sendTimeOf,
} from "./reminder-recipients";
import { slackService } from "./slack.service";
import type { Ctx } from "./types";

// When the reminders go out and to whom (docs/plans/reminder-settings.md). The
// rules that turn these settings into a list of people are in
// `reminder-recipients.ts`, shared with the jobs; this is the settings row and
// the preview.

export type ReminderPreviewPerson = {
	userId: string;
	name: string;
	email: string;
	reason: string;
};

export type ReminderPreview = {
	kind: ReminderKind;
	date: string;
	/** Why nothing of this kind goes out on `date`, or null when it does. */
	skipped: string | null;
	/** "HH:mm" in the org timezone, or null for "at the end of each person's
	 *  own workday". */
	sendsAt: string | null;
	/** Who gets it, and the text they get. */
	recipients: (ReminderPreviewPerson & { message: string })[];
	/** Who the rules picked but a delivery gate holds back — archived, never
	 *  signed in, opted out — with the gate as the reason. */
	heldBack: ReminderPreviewPerson[];
};

const HELD_BACK_REASON = {
	"not-a-member": "Not a member of this workspace",
	archived: "Archived",
	"never-signed-in": "Has never signed in",
	"opted-out": "Turned log reminders off",
} satisfies Record<DeliveryBlock, string>;

// The database says `member_type[]`, which includes the overhead employee; the
// check on the column does not, and neither does the schema. Filtering rather
// than asserting keeps a hand-edited row from reaching the jobs as a type it
// cannot hold.
const naggableTypes = (types: MemberTypeValue[]): NaggableMemberType[] =>
	types.filter(
		(type): type is NaggableMemberType => type !== "employee_overhead",
	);

/** The settings, for any caller in the org. A missing row is the defaults.
 *  No admin check: the jobs read this for every org on nobody's behalf, and
 *  the server function in front of it is admin-only. */
const read = async (ctx: Ctx): Promise<ReminderSettings> => {
	const row = await db.query.reminderSettings.findFirst({
		where: eq(reminderSettings.organizationId, ctx.organizationId),
	});
	if (!row) return REMINDER_SETTINGS_DEFAULTS;
	return {
		logEnabled: row.logEnabled,
		logMode: row.logMode,
		logTime: row.logTime,
		logBelowPct: row.logBelowPct,
		nudgeEnabled: row.nudgeEnabled,
		nudgeWeekdays: row.nudgeWeekdays,
		nudgeTime: row.nudgeTime,
		nudgeMemberTypes: naggableTypes(row.nudgeMemberTypes),
		monthEndEnabled: row.monthEndEnabled,
		monthEndDaysBefore: row.monthEndDaysBefore,
		monthEndTime: row.monthEndTime,
		monthEndOnlyBehind: row.monthEndOnlyBehind,
		monthEndMemberTypes: naggableTypes(row.monthEndMemberTypes),
		digestEnabled: row.digestEnabled,
		digestWeekday: row.digestWeekday,
		digestTime: row.digestTime,
		includeNeverSignedIn: row.includeNeverSignedIn,
	};
};

const uniqueSorted = <T extends number | string>(values: T[]): T[] =>
	[...new Set(values)].sort();

export const reminderSettingsService = {
	get: read,

	/** Save the fields in `patch` and leave the others alone. */
	update: async (
		ctx: Ctx,
		patch: UpdateReminderSettingsInput,
	): Promise<ReminderSettings> => {
		await requireAdmin(ctx);
		const own = { ...patch };

		// The day and type lists are sets. The schema already refuses a repeat;
		// this keeps a caller that skipped it from writing one, since the
		// database's "at most three days" counts entries, not distinct days.
		if (own.nudgeWeekdays) own.nudgeWeekdays = uniqueSorted(own.nudgeWeekdays);
		if (own.nudgeMemberTypes) {
			own.nudgeMemberTypes = uniqueSorted(own.nudgeMemberTypes);
		}
		if (own.monthEndMemberTypes) {
			own.monthEndMemberTypes = uniqueSorted(own.monthEndMemberTypes);
		}

		if (Object.keys(own).length > 0) {
			await db
				.insert(reminderSettings)
				.values({ organizationId: ctx.organizationId, ...own })
				.onConflictDoUpdate({
					target: reminderSettings.organizationId,
					set: { ...own, updatedAt: new Date() },
				});
		}
		return read(ctx);
	},

	/**
	 * "Who gets this today": the people `kind` goes to on `date`, by the same
	 * rules the job sends by, and the people a delivery gate holds back.
	 *
	 * The time of day is ignored — the question is about the day — so a preview
	 * at 08:00 of the 09:00 nudge already names its recipients. So is the
	 * "already sent today" claim: a person who got it this morning still shows,
	 * because they are who it goes to.
	 */
	preview: async (
		ctx: Ctx,
		kind: ReminderKind,
		date: string,
	): Promise<ReminderPreview> => {
		await requireAdmin(ctx);
		const [settings, tz, org] = await Promise.all([
			read(ctx),
			ctxTimezone(ctx),
			db.query.organization.findFirst({
				where: eq(organization.id, ctx.organizationId),
				columns: { slug: true },
			}),
		]);
		const result: ReminderPreview = {
			kind,
			date,
			skipped: null,
			sendsAt: sendTimeOf(settings, kind),
			recipients: [],
			heldBack: [],
		};

		if (kind !== "log-reminder") {
			const installation = await slackService.installationFor(
				ctx.organizationId,
			);
			if (!installation) {
				result.skipped =
					"Slack is not connected, so no Slack reminder goes out.";
				return result;
			}
		}
		result.skipped = await reminderDayCheck(ctx, settings, kind, date);
		if (result.skipped) return result;

		// Midday in the org's timezone: squarely inside `date` whatever the
		// offset, which is all the compliance views need from the instant.
		const now = new Date(
			dayBoundsInTz(date, tz).start.getTime() + 12 * 3_600_000,
		);
		const picked = await reminderRecipients(
			ctx,
			settings,
			kind,
			{ dayKey: date, timeKey: null, tz, now, slug: org?.slug ?? "" },
			dashboardLoader(ctx, settings, now),
		);
		const blocks = await deliveryBlocks(
			ctx.organizationId,
			picked.map((p) => p.userId),
			kind,
		);

		for (const person of picked.sort((a, b) => a.name.localeCompare(b.name))) {
			const block = blocks.get(person.userId);
			const who = {
				userId: person.userId,
				name: person.name,
				email: person.email,
			};
			if (block) {
				result.heldBack.push({ ...who, reason: HELD_BACK_REASON[block] });
			} else {
				result.recipients.push({
					...who,
					reason: person.reason,
					message: person.event.title
						? `${person.event.title}. ${person.event.body}`
						: person.event.body,
				});
			}
		}
		return result;
	},
};
