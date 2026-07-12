import { and, eq, gte, lt, inArray } from "drizzle-orm";
import { db } from "../db";
import { account } from "../db/schema/auth";
import { project, timeEntry } from "../db/schema/domain";
import { syncedMeetingTombstone } from "../db/schema/settings";
import {
	middayBreakStartMin,
	type MinuteInterval,
	minutesToTimeKey,
	placeBlocks,
	SLOT_SECONDS,
	splitProportionally,
	summarizeCommitMessages,
	timeKeyToMinutes,
} from "../lib/day-plan";
import { orgTimezone } from "../lib/org-time";
import {
	dayBoundsInTz,
	minutesSinceMidnightInTz,
	secondsBetween,
	timeKeyInTz,
	weekdayInTz,
} from "../lib/time";
import type {
	ApplyDayAssemblyInput,
	SuggestDayAssemblyInput,
} from "../schema/day-assembly";
import { entryTypesService } from "./entry-types.service";
import { githubService } from "./github.service";
import { googleCalendarService } from "./google-calendar.service";
import { recurringBlockRulesService } from "./recurring-block-rules.service";
import { timeEntriesService } from "./time-entries.service";
import type { Ctx } from "./types";
import { dayDurationSeconds, workingHoursService } from "./working-hours.service";

export type DaySuggestionCommit = {
	projectGithubRepoId: string;
	sha: string;
	message: string;
	repoFullName: string;
};

// A workday longer than this legally requires a rest break (Croatian Labour
// Act art. 73: >6h/day → a paid break counted within working time), so the
// break is carved out of the day's target rather than added on top of it.
const BREAK_MIN_WORKDAY_SECONDS = 6 * 60 * 60;
const DEFAULT_BREAK_SECONDS = 30 * 60;

export type DaySuggestion = {
	// Stable client-side key: "meeting:<eventId>" | "work:<projectId>" | "break" | "fill".
	key: string;
	kind: "meeting" | "work" | "break" | "fill";
	typeId: string;
	projectId: string | null;
	projectName: string | null;
	description: string;
	startTime: string;
	endTime: string;
	durationSeconds: number;
	billable: boolean;
	fillsDay: boolean;
	meetingUrl: string | null;
	calendarEventId: string | null;
	commits: DaySuggestionCommit[];
};

export type DayAssembly = {
	date: string;
	targetSeconds: number;
	loggedSeconds: number;
	suggestions: DaySuggestion[];
	// "unavailable" means the account isn't connected, so that signal was
	// silently empty — the UI uses it to hint at connecting the integration.
	sources: {
		calendar: "ok" | "unavailable";
		github: "ok" | "unavailable";
	};
};

const hasLinkedAccount = async (userId: string, providerId: string) => {
	const row = await db.query.account.findFirst({
		where: and(eq(account.userId, userId), eq(account.providerId, providerId)),
		columns: { id: true },
	});
	return !!row;
};

export const dayAssemblyService = {
	// Read-only preview: gather every signal we have for the day (calendar
	// meetings, GitHub commits per project, working hours) and propose the
	// blocks that would complete it. Nothing is written except the recurring
	// materializer, which every time-page read already runs.
	suggest: async (
		ctx: Ctx,
		input: SuggestDayAssemblyInput,
	): Promise<DayAssembly> => {
		const { date } = input;
		await recurringBlockRulesService.materializeRange(ctx, date, date);

		const tz = await orgTimezone(ctx.organizationId);
		const { start, end } = dayBoundsInTz(date, tz);

		const [existing, workingHours, types, calendarEvents, commits] =
			await Promise.all([
				db.query.timeEntry.findMany({
					where: and(
						eq(timeEntry.organizationId, ctx.organizationId),
						eq(timeEntry.userId, ctx.userId),
						gte(timeEntry.startedAt, start),
						lt(timeEntry.startedAt, end),
					),
					columns: {
						startedAt: true,
						durationSeconds: true,
						fillsDay: true,
						calendarEventId: true,
						typeId: true,
					},
				}),
				workingHoursService.list(ctx),
				entryTypesService.listAvailable(ctx),
				googleCalendarService
					.listEventsForRange(ctx, { from: date, to: date })
					.catch((error) => {
						console.error("[day-assembly] calendar read failed", error);
						return null;
					}),
				githubService.listUserCommitsForDay(ctx, date).catch((error) => {
					console.error("[day-assembly] commit read failed", error);
					return [];
				}),
			]);

		const meetingType = types.find((t) => t.name === "Meeting");
		const workType = types.find((t) => t.name === "Work");
		const breakType = types.find((t) => t.name === "Break");

		const weekday = weekdayInTz(date, tz);
		const day = workingHours.find((d) => d.dayOfWeek === weekday);
		const targetSeconds = day ? dayDurationSeconds(day) : 0;
		const dayStartMin = timeKeyToMinutes(
			day?.enabled && day.startTime ? day.startTime : "09:00",
		);

		const loggedSeconds = existing.reduce(
			(sum, e) => sum + e.durationSeconds,
			0,
		);
		// Fill blocks are excluded from "spoken-for" time on both axes: their
		// duration is derived and re-shrinks as siblings appear, so they neither
		// consume the remaining budget nor block the timeline.
		const existingNonFillSeconds = existing
			.filter((e) => !e.fillsDay)
			.reduce((sum, e) => sum + e.durationSeconds, 0);
		const busy: MinuteInterval[] = existing
			.filter((e) => !e.fillsDay)
			.map((e) => {
				const startMin = minutesSinceMidnightInTz(e.startedAt, tz);
				return {
					startMin,
					endMin: startMin + Math.round(e.durationSeconds / 60),
				};
			});

		const suggestions: DaySuggestion[] = [];

		// ── Meetings: calendar events not yet on the timeline ───────────────────
		let meetingSeconds = 0;
		if (calendarEvents && calendarEvents.length > 0 && meetingType) {
			const tombstones = await db.query.syncedMeetingTombstone.findMany({
				where: and(
					eq(syncedMeetingTombstone.organizationId, ctx.organizationId),
					eq(syncedMeetingTombstone.userId, ctx.userId),
				),
				columns: { calendarEventId: true },
			});
			const skipIds = new Set(tombstones.map((t) => t.calendarEventId));
			for (const e of existing) {
				if (e.calendarEventId) skipIds.add(e.calendarEventId);
			}

			for (const event of calendarEvents) {
				if (skipIds.has(event.id)) continue;
				const startedAt = new Date(event.start);
				const stoppedAt = new Date(event.end);
				const durationSeconds = secondsBetween(startedAt, stoppedAt);
				if (durationSeconds <= 0) continue;
				meetingSeconds += durationSeconds;
				const startMin = minutesSinceMidnightInTz(startedAt, tz);
				busy.push({
					startMin,
					endMin: startMin + Math.round(durationSeconds / 60),
				});
				suggestions.push({
					key: `meeting:${event.id}`,
					kind: "meeting",
					typeId: meetingType.id,
					projectId: null,
					projectName: null,
					description: event.title,
					startTime: timeKeyInTz(startedAt, tz),
					endTime: timeKeyInTz(stoppedAt, tz),
					durationSeconds,
					billable: meetingType.billableDefault,
					fillsDay: false,
					meetingUrl: event.meetingUrl,
					calendarEventId: event.id,
					commits: [],
				});
			}
		}

		// ── Break: a legally-required rest interval carved out of the working
		// window (not added on top of it), placed near midday and shifted off any
		// meeting it would overlap. Skipped for short days, when there's no room
		// left to cover, and when a break is already logged for the day. ─────────
		const preBreakRemaining = Math.max(
			0,
			targetSeconds - existingNonFillSeconds - meetingSeconds,
		);
		let breakSeconds = 0;
		if (
			breakType &&
			targetSeconds > BREAK_MIN_WORKDAY_SECONDS &&
			preBreakRemaining >= DEFAULT_BREAK_SECONDS &&
			!existing.some((e) => e.typeId === breakType.id)
		) {
			const [placement] = placeBlocks(
				[DEFAULT_BREAK_SECONDS / 60],
				busy,
				middayBreakStartMin(dayStartMin, targetSeconds),
			);
			if (placement) {
				breakSeconds = DEFAULT_BREAK_SECONDS;
				busy.push({ startMin: placement.startMin, endMin: placement.endMin });
				suggestions.push({
					key: "break",
					kind: "break",
					typeId: breakType.id,
					projectId: null,
					projectName: null,
					description: "",
					startTime: minutesToTimeKey(placement.startMin),
					endTime: minutesToTimeKey(placement.endMin),
					durationSeconds: (placement.endMin - placement.startMin) * 60,
					billable: breakType.billableDefault,
					fillsDay: false,
					meetingUrl: null,
					calendarEventId: null,
					commits: [],
				});
			}
		}

		const remainingSeconds = Math.max(0, preBreakRemaining - breakSeconds);

		// ── Work: one block per project the user committed to that day ──────────
		const commitsByProject = new Map<string, typeof commits>();
		for (const commit of commits) {
			const list = commitsByProject.get(commit.projectId) ?? [];
			list.push(commit);
			commitsByProject.set(commit.projectId, list);
		}

		if (commitsByProject.size > 0 && workType && remainingSeconds >= SLOT_SECONDS) {
			const projectIds = [...commitsByProject.keys()];
			const projects = await db.query.project.findMany({
				where: and(
					eq(project.organizationId, ctx.organizationId),
					inArray(project.id, projectIds),
				),
				columns: { id: true, name: true },
			});
			const nameById = new Map(projects.map((p) => [p.id, p.name]));

			const groups = projectIds
				.filter((id) => nameById.has(id))
				.map((id) => ({
					projectId: id,
					commits: commitsByProject.get(id) ?? [],
				}));
			const shares = splitProportionally(
				remainingSeconds,
				groups.map((g) => g.commits.length),
			);
			const placements = placeBlocks(
				shares.map((s) => Math.round(s / 60)),
				busy,
				dayStartMin,
			);

			groups.forEach((group, index) => {
				const placement = placements[index];
				const share = shares[index] ?? 0;
				if (!placement || share <= 0) return;
				suggestions.push({
					key: `work:${group.projectId}`,
					kind: "work",
					typeId: workType.id,
					projectId: group.projectId,
					projectName: nameById.get(group.projectId) ?? null,
					description: summarizeCommitMessages(
						group.commits.map((c) => c.message),
					),
					startTime: minutesToTimeKey(placement.startMin),
					endTime: minutesToTimeKey(placement.endMin),
					durationSeconds: (placement.endMin - placement.startMin) * 60,
					billable: workType.billableDefault,
					fillsDay: false,
					meetingUrl: null,
					calendarEventId: null,
					commits: group.commits.map((c) => ({
						projectGithubRepoId: c.projectGithubRepoId,
						sha: c.sha,
						message: c.message,
						repoFullName: c.repoFullName,
					})),
				});
			});
		} else if (
			workType &&
			remainingSeconds > 0 &&
			!existing.some((e) => e.fillsDay)
		) {
			// ── Fill: no commit evidence to attribute, so propose one derived
			// "rest of day" block that absorbs the remaining working hours. ───────
			suggestions.push({
				key: "fill",
				kind: "fill",
				typeId: workType.id,
				projectId: null,
				projectName: null,
				description: "",
				startTime: minutesToTimeKey(dayStartMin),
				endTime: minutesToTimeKey(dayStartMin),
				durationSeconds: remainingSeconds,
				billable: workType.billableDefault,
				fillsDay: true,
				meetingUrl: null,
				calendarEventId: null,
				commits: [],
			});
		}

		suggestions.sort((a, b) => a.startTime.localeCompare(b.startTime));

		const [githubLinked, googleLinked] = await Promise.all([
			hasLinkedAccount(ctx.userId, "github"),
			hasLinkedAccount(ctx.userId, "google-calendar"),
		]);

		return {
			date,
			targetSeconds,
			loggedSeconds,
			suggestions,
			sources: {
				calendar: calendarEvents !== null && googleLinked ? "ok" : "unavailable",
				github: githubLinked ? "ok" : "unavailable",
			},
		};
	},

	// Create the accepted suggestions. Runs through timeEntriesService.create so
	// every invariant (type availability, fill uniqueness, fill recompute,
	// sync-lock on calendar-linked rows) holds exactly as if entered by hand.
	// Best-effort per entry: one failure doesn't abort the rest.
	apply: async (ctx: Ctx, input: ApplyDayAssemblyInput) => {
		// Fill blocks last — their derived duration must see the siblings first.
		const ordered = [...input.entries].sort(
			(a, b) => Number(a.fillsDay ?? false) - Number(b.fillsDay ?? false),
		);

		let created = 0;
		const errors: string[] = [];
		for (const entry of ordered) {
			try {
				const row = await timeEntriesService.create(ctx, {
					typeId: entry.typeId,
					projectId: entry.projectId,
					description: entry.description,
					date: input.date,
					startTime: entry.startTime,
					endTime: entry.fillsDay ? entry.startTime : entry.endTime,
					billable: entry.billable,
					fillsDay: entry.fillsDay || undefined,
					meetingUrl: entry.meetingUrl,
					calendarEventId: entry.calendarEventId,
				});
				created += 1;
				if (entry.commits && entry.commits.length > 0) {
					// Evidence attachment is decoration — never fail the entry over it.
					await githubService
						.attachCommits(ctx, {
							timeEntryId: row.id,
							commits: entry.commits,
						})
						.catch((error) =>
							console.error("[day-assembly] attachCommits failed", error),
						);
				}
			} catch (error) {
				errors.push(
					error instanceof Error ? error.message : "Failed to create entry",
				);
			}
		}
		return { created, errors };
	},
};
