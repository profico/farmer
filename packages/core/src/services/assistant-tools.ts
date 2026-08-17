// What the assistant is allowed to do, and how it is described to the model.
//
// Every tool is a thin adapter onto a service function called with the CALLER'S
// OWN Ctx. That is the whole security model and it is deliberately not restated
// here: a Member's `list_time_entries` returns only their rows because
// `timeEntriesService.listRange` filters on `ctx.userId`, and `create_time_entry`
// refuses a project they aren't assigned to because `assertCanTrackOn` says so.
// A tool that re-implemented either check would be a second copy of the §4
// matrix, and the second copy is always the one that drifts.
//
// The `parameters` are the EXISTING Zod inputs from `src/schema/*`, converted
// with zod 4's own `z.toJSONSchema()`. Not a hand-written JSON Schema per tool:
// `api/v1/time-entries` is what re-validating by hand looks like six months
// later — it re-spelled the range check and dropped the 62-day ceiling doing it.
// Here the model is handed the same ceiling the UI has.
//
// Tools are added in pairs with whatever produces their arguments. A write whose
// ids no read returns cannot be called at all, which is how `file_time_entries`
// spent its first months uncallable: it takes entry ids, and the only tool that
// could have produced one reported a null project for absence too, so the one
// action that clears what blocks the close could only be aimed by guessing.

import { z } from "zod";
import {
	absenceReportInput,
	absenceTotalsInput,
	applyDayAssemblyInput,
	assignProjectMemberInput,
	attachCommitsInput,
	clientIdInput,
	closeSheetInput,
	closeTransitionInput,
	copyTimeEntriesInput,
	copyWeekEntriesInput,
	createClientInput,
	createProjectInput,
	createRecurringBlockRuleInput,
	createTaskInput,
	createTimeEntryInput,
	deleteRecurringBlockRuleInput,
	deleteTimeEntryInput,
	fileTimeEntriesInput,
	listAbsenceForUserInput,
	listTimeEntriesRangeInput,
	logAbsenceRangeInput,
	monthReportInput,
	projectIdInput,
	saveCloseRowInput,
	setCloseRowFinalInput,
	setTimeEntryOvertimeInput,
	suggestDayAssemblyInput,
	taskIdInput,
	timeReportDetailInput,
	timeReportSummaryInput,
	updateProjectInput,
	updateRecurringBlockRuleInput,
	updateTaskInput,
	updateTimeEntryDescriptionInput,
	updateTimeEntryInput,
	userCommitsRangeInput,
	yearReportInput,
} from "../schema";
import type { Access } from "./access.service";
import { clientsService } from "./clients.service";
import { closeService } from "./close.service";
import { ctxAccess, ctxTimezone } from "./context";
import { dayAssemblyService } from "./day-assembly.service";
import { githubService } from "./github.service";
import { holidaysService } from "./holidays.service";
import { membersService } from "./members.service";
import { projectsService } from "./projects.service";
import { recurringBlockRulesService } from "./recurring-block-rules.service";
import { reportsService } from "./reports.service";
import { tasksService } from "./tasks.service";
import { timeEntriesService } from "./time-entries.service";
import type { Ctx } from "./types";
import { listUnfiledForUser, unfiledTotals } from "./unfiled";
import { workingHoursService } from "./working-hours.service";

/**
 * How much consent a tool needs before it runs.
 *
 *   read         answers a question; runs inline.
 *   write        creates or corrects something; runs inline. Reversible by
 *                doing the opposite thing, and stopping to ask before every
 *                one of them turns "fix up my week from my commits" into
 *                fifteen dialogs, which is the interaction the feature exists
 *                to replace.
 *   destructive  removes or retires something. Suspends the turn for approval.
 *
 * The line is "can the person undo this by asking for the opposite" — editing
 * an entry's hours can be edited back; archiving a project cannot be un-asked
 * for by someone who never saw it happen. Moving a tool between tiers is one
 * word here, deliberately, because where the line sits is a judgement that will
 * be revisited.
 *
 * The two close transitions sit on that line in a way worth naming, because
 * they look like one decision and are two. `close_submit` is a write: a PM may
 * re-open and re-submit freely right up until an Admin finalizes. `close_finalize`
 * is destructive even though it deletes nothing — it FREEZES the Reported,
 * Expected and Overtime snapshots that the variance report and the invoice are
 * read off, and re-opening deliberately leaves those snapshots in place. What it
 * captured cannot be re-captured by asking for the opposite, which is the test.
 */
export type ToolKind = "read" | "write" | "destructive";

/**
 * What a batch write is about to do, one row per thing it would touch.
 *
 * The third state between "runs inline" and "one dialog per write". A tool that
 * supplies this suspends the turn ONCE for the whole batch and is shown as a
 * checklist — which is not the fifteen dialogs the write tier exists to avoid,
 * because fifteen rows in one card is still one decision. It is also the only
 * place partial consent is expressible: "yes to four of these five" has no
 * spelling in an approve/reject pair, and the alternative is the person
 * rejecting the lot and re-asking with the exception described in prose.
 *
 * `cells` are strings and already resolved — an approval card that shows a row
 * of uuids is not consent, it is a form. Building them costs lookups on the way
 * to ASKING, so every one of them is best-effort (see `preview` below).
 */
export type ApprovalPreview = {
	columns: string[];
	rows: { id: string; cells: string[] }[];
	/** Shown under the table — what was left out, if the batch overran the cap. */
	note?: string;
};

/** How many rows a preview will render. A batch of 200 is a scroll, not a
 *  review; past this the card says so and approval covers the whole batch. */
const MAX_PREVIEW_ROWS = 25;

export type AssistantTool = {
	name: string;
	description: string;
	kind: ToolKind;
	schema: z.ZodType;
	/**
	 * Whether this caller is offered the tool at all.
	 *
	 * NOT a security check. The service behind every tool re-resolves `Access` and
	 * asserts, which is what actually protects the data, and this file must never
	 * hold a second copy of the matrix. This is about what the model is TOLD it
	 * can do: every definition is re-sent on every step of every turn, so offering
	 * a Member the close sheet and the admin reports costs tokens on each one and
	 * buys a tool call that can only come back refused — and a model that has
	 * spent two of its eight steps being refused is a model that answers worse.
	 * A capability the caller does not have is better expressed by the tool being
	 * absent than by them discovering the refusal.
	 *
	 * Absent means "everyone". Predicates stay coarse on purpose — "is a PM
	 * anywhere", never "is a PM on THIS project" — because the arguments do not
	 * exist when the list is built, and narrowing it here would be exactly the
	 * second copy of the matrix.
	 */
	available?: (access: Access) => boolean;
	/**
	 * One line naming what approving would actually do, for the approval card.
	 *
	 * Written from the ARGUMENTS rather than the tool name, because "delete a
	 * time entry" is not a thing anyone can meaningfully consent to — and neither
	 * is "Archive project 3f2a9b1c…", which is what naming an argument without
	 * resolving it produces. So this gets the Ctx and may look the id up: the card
	 * says "Archive Acme Redesign", and the person either recognises it or does
	 * not. That recognition is the entire point of asking.
	 *
	 * Best-effort by construction. A lookup that fails falls back to a generic
	 * phrase rather than throwing, because a card that failed to render is a
	 * person stuck on a turn they can resolve neither way.
	 */
	summarize?: (
		ctx: Ctx,
		args: Record<string, unknown>,
	) => string | Promise<string>;
	/**
	 * The rows this call would write, for the approval card. Its PRESENCE is what
	 * makes a `write` tool stop and ask — see `ApprovalPreview`.
	 *
	 * Best-effort in exactly the way `summarize` is, and for the same reason: it
	 * runs on the way to asking for consent, so a lookup that throws must cost
	 * the table, not the card. Returning null falls back to the summary line
	 * alone, which is the behaviour every other approval already has.
	 */
	preview?: (
		ctx: Ctx,
		args: Record<string, unknown>,
	) => Promise<ApprovalPreview | null>;
	/**
	 * Rebuild the arguments from the rows the person actually ticked.
	 *
	 * Only called when the card came back with a selection, and only for tools
	 * that offer it — a tool with a `preview` but no `withSelection` is all-or-
	 * nothing, which is right for a batch whose rows aren't separable. The ids
	 * are the `preview` row ids, so the two are written together or not at all.
	 */
	withSelection?: (
		args: Record<string, unknown>,
		selectedRowIds: string[],
	) => Record<string, unknown>;
	run: (ctx: Ctx, args: unknown) => Promise<unknown>;
};

const hours = (seconds: unknown) =>
	typeof seconds === "number" ? `${(seconds / 3600).toFixed(2)}h` : "?";

/** Seconds → hours, preserving null. Null is a real answer in the close sheet
 *  (nobody has overridden the column) and is not the same as zero. */
const optionalHours = (seconds: number | null | undefined) =>
	seconds == null ? null : seconds / 3600;

/** A display name for an approval card, or a phrase that at least reads as
 *  English. Never throws — see `summarize`. */
const nameOr = async (
	load: () => Promise<{ name: string } | null | undefined>,
	fallback: string,
): Promise<string> => {
	try {
		return (await load())?.name ?? fallback;
	} catch {
		return fallback;
	}
};

// ── availability predicates ──────────────────────────────────────────────────
//
// All phrased as "…anywhere": they answer "is this person ever in a position to
// use this tool", which is the only form of the question that can be answered
// before the arguments exist.

const adminOnly = (access: Access) => access.isAdmin;

/** Reports refuse a caller who leads nothing — `reportScope` throws outright —
 *  so a plain Member is offered none of them rather than being handed four
 *  tools whose only possible answer is an access error. */
const leadsSomething = (access: Access) =>
	access.isAdmin || access.assignments().some(([, role]) => role !== "member");

/** The close is PM-and-up. `closeService.overview` returns [] rather than
 *  throwing for everyone else, and a tool whose honest answer is always an
 *  empty list is worse than no tool: the model reports "nothing is open". */
const pmSomewhere = (access: Access) =>
	access.isAdmin || access.assignments().some(([, role]) => role === "pm");

const canCreateProjects = (access: Access) => access.canCreateProjects();

export const ASSISTANT_TOOLS: AssistantTool[] = [
	// ── reads: who, and what exists ─────────────────────────────────────────
	{
		name: "whoami",
		kind: "read",
		description:
			"The current user: their name and user id, org role, member type, timezone, working-hours schedule and weekly target, and the projects they are on with their role on each. Call this when a question depends on who is asking, on what counts as a full day for them, or when another tool needs their user id.",
		schema: z.object({}),
		// One call rather than four, because these are asked together or not at
		// all. Without it the model knew the date and nothing else about the person
		// it was answering as — it could not say whether a 6-hour day was short,
		// and `time_report_summary` grouped by teammate handed back names it had no
		// way to turn back into the ids every other tool takes.
		run: async (ctx) => {
			const [access, people, workingHours, weeklyTargetSeconds, timezone] =
				await Promise.all([
					ctxAccess(ctx),
					membersService.list(ctx),
					workingHoursService.list(ctx),
					workingHoursService.getWeeklyTarget(ctx),
					ctxTimezone(ctx),
				]);
			const me = people.find((person) => person.userId === ctx.userId);
			const myProjects = await projectsService.listMine(ctx);

			return {
				userId: ctx.userId,
				name: me?.name ?? null,
				email: me?.email ?? null,
				orgRole: me?.orgRole ?? null,
				isAdmin: access.isAdmin,
				memberType: me?.type ?? null,
				startDate: me?.startDate ?? null,
				timezone,
				weeklyTargetSeconds,
				// 0 = Sunday. Enabled days only: a list of five IS the schedule, where
				// seven rows with two disabled is the same thing spelled longer.
				workingDays: workingHours
					.filter((day) => day.enabled)
					.map((day) => ({
						dayOfWeek: day.dayOfWeek,
						startTime: day.startTime,
						endTime: day.endTime,
					})),
				canCreateProjects: access.canCreateProjects(),
				projects: myProjects.map((row) => ({
					id: row.id,
					name: row.name,
					role: access.roleOn(row.id),
				})),
			};
		},
	},
	{
		name: "list_time_entries",
		kind: "read",
		description:
			"List the current user's own time entries between two dates (inclusive, yyyy-MM-dd, max 62 days apart). Returns each entry's date, duration, description, task and project.",
		schema: listTimeEntriesRangeInput,
		run: async (ctx, args) => {
			const input = listTimeEntriesRangeInput.parse(args);
			const rows = await timeEntriesService.listRange(ctx, input);
			// Projected rather than passed through: the raw row carries ids, sync
			// bookkeeping and commit counts that cost tokens and tell the model
			// nothing it can use.
			return rows.map((row) => ({
				id: row.id,
				date: row.date,
				hours: row.durationSeconds / 3600,
				description: row.description,
				task: row.task?.name ?? null,
				project: row.project?.name ?? null,
				client: row.project?.client?.name ?? null,
				overtime: row.overtime,
			}));
		},
	},
	{
		name: "list_unfiled_entries",
		kind: "read",
		description:
			"The current user's unfiled entries between two dates, with their ids — real worked time (synced meetings, commit blocks) that carries no project yet. These are what file_time_entries attributes, and unfiled time is what blocks the monthly close.",
		schema: listTimeEntriesRangeInput,
		run: async (ctx, args) => {
			const input = listTimeEntriesRangeInput.parse(args);
			const rows = await listUnfiledForUser(ctx, input);
			return rows.map((row) => ({
				id: row.id,
				date: row.date,
				hours: row.durationSeconds / 3600,
				description: row.description,
				task: row.taskName,
				meetingUrl: row.meetingUrl,
			}));
		},
	},
	{
		name: "list_projects",
		kind: "read",
		description:
			"List the projects the current user may log time against, with their ids, type and clients. Call this before creating a time entry — a project must be named by id.",
		schema: z.object({}),
		run: async (ctx) => {
			const rows = await projectsService.listMine(ctx);
			return rows.map((row) => ({
				id: row.id,
				name: row.name,
				type: row.type,
				client: row.client?.name ?? null,
			}));
		},
	},
	{
		name: "list_tasks",
		kind: "read",
		description:
			"List the task types a time entry can be filed under (Development, Meeting, …), with their ids. Every time entry needs one. Absence tasks (Vacation, Sick Leave) are included and flagged with isAbsence — those carry no project and are what log_absence takes.",
		schema: z.object({}),
		// Both lists. `listSelectable` excludes absence by design, since it feeds
		// the worked-time picker — which left `log_absence` unable to learn the id
		// of the one kind of task it accepts.
		run: async (ctx) => {
			const [selectable, absence] = await Promise.all([
				tasksService.listSelectable(ctx),
				tasksService.listAbsenceTasks(),
			]);
			return [
				...selectable.map((row) => ({
					id: row.id,
					name: row.name,
					isAbsence: false,
				})),
				...absence.map((row) => ({
					id: row.id,
					name: row.name,
					isAbsence: true,
				})),
			];
		},
	},
	{
		name: "list_clients",
		kind: "read",
		description:
			"List the organization's clients with their ids. Needed before creating a project, which must name one.",
		schema: z.object({}),
		run: async (ctx) => {
			const rows = await clientsService.list(ctx);
			return rows.map((row) => ({ id: row.id, name: row.name }));
		},
	},
	{
		name: "list_members",
		kind: "read",
		description:
			"Everyone in the organization with their user ids — how a person named in the question becomes the id the other tools take.",
		schema: z.object({}),
		run: async (ctx) => {
			const [access, rows] = await Promise.all([
				ctxAccess(ctx),
				membersService.list(ctx),
			]);
			return rows.map((row) => ({
				userId: row.userId,
				name: row.name,
				email: row.email,
				orgRole: row.orgRole,
				archived: row.archivedAt !== null,
				// Billable/overhead/contractor decides Expected on the close sheet, so
				// it travels with the money picture rather than with the directory: a
				// roster is not sensitive within an org, and who is a contractor is.
				...(access.isAdmin ? { memberType: row.type } : {}),
			}));
		},
	},
	{
		name: "list_project_members",
		kind: "read",
		description:
			"Who is assigned to a project and in what role (member, team_lead, pm).",
		schema: z.object({ projectId: projectIdInput }),
		available: leadsSomething,
		run: async (ctx, args) => {
			const { projectId } = z.object({ projectId: projectIdInput }).parse(args);
			const rows = await projectsService.listMembers(ctx, projectId);
			return rows.map((row) => ({
				userId: row.userId,
				name: row.name,
				role: row.role,
				active: row.active,
			}));
		},
	},
	{
		name: "list_holidays",
		kind: "read",
		description:
			"The organization's public holidays for a year, as dates. Use this rather than assuming which days are holidays — it follows the org's own country and its opt-outs.",
		schema: yearReportInput,
		run: async (ctx, args) => {
			const { year } = yearReportInput.parse(args);
			return holidaysService.listForYear(ctx, year);
		},
	},
	{
		name: "list_recurring_block_rules",
		kind: "read",
		description:
			"The current user's recurring block rules — the standing entries (a daily break, a weekly stand-up) that materialize automatically. This is what explains entries the person did not type.",
		schema: z.object({}),
		run: async (ctx) => {
			const rows = await recurringBlockRulesService.list(ctx);
			return rows.map((row) => ({
				id: row.id,
				task: row.task?.name ?? null,
				project: row.project?.name ?? null,
				description: row.description,
				daysOfWeek: row.daysOfWeek,
				hours: row.durationSeconds / 3600,
				effectiveFrom: row.effectiveFrom,
				effectiveUntil: row.effectiveUntil,
			}));
		},
	},
	{
		name: "list_commits",
		kind: "read",
		description:
			"The current user's GitHub commits between two dates (inclusive, max 31 days apart), across every repo linked to a project in this org, grouped by day. Use this as evidence for what was worked on when reconstructing time.",
		schema: userCommitsRangeInput,
		// A span rather than a day. Reconstructing a WEEK through a day-shaped read
		// is seven round trips out of a turn's eight, so the interaction this
		// feature exists for could run out of steps before writing anything.
		run: async (ctx, args) => {
			const input = userCommitsRangeInput.parse(args);
			// Returns [] rather than throwing when GitHub isn't connected, so the
			// model gets "no evidence" instead of an error it will try to work
			// around — matching how day-assembly degrades.
			const days = await githubService.listUserCommitsByDay(ctx, input);
			return days.map((day) => ({
				date: day.dayKey,
				commits: day.commits.map((commit) => ({
					// Both ids: `attach_commits` needs the repo row and the sha, and a
					// write whose arguments no read produces cannot be called at all.
					projectGithubRepoId: commit.projectGithubRepoId,
					projectId: commit.projectId,
					sha: commit.sha,
					// First line only: commit bodies are long, repetitive, and none of
					// this is worth the context window.
					message: commit.message.split("\n")[0],
					committedAt: commit.committedAt.toISOString(),
				})),
			}));
		},
	},
	{
		name: "suggest_day",
		kind: "read",
		description:
			"What is missing from one day: its target, what is already logged, and suggested entries built from the person's calendar meetings, commits, recurring blocks and the rest of the working day. Prefer this over reconstructing a day by hand, then pass the suggestions you are accepting to apply_day_assembly.",
		schema: suggestDayAssemblyInput,
		run: async (ctx, args) => {
			const input = suggestDayAssemblyInput.parse(args);
			const assembly = await dayAssemblyService.suggest(ctx, input);
			return {
				date: assembly.date,
				targetHours: assembly.targetSeconds / 3600,
				loggedHours: assembly.loggedSeconds / 3600,
				suggestions: assembly.suggestions.map((suggestion) => ({
					kind: suggestion.kind,
					taskId: suggestion.taskId,
					task: suggestion.taskName,
					projectId: suggestion.projectId,
					project: suggestion.projectName,
					description: suggestion.description,
					hours: suggestion.durationSeconds / 3600,
					fillsDay: suggestion.fillsDay,
					meetingUrl: suggestion.meetingUrl,
					calendarEventId: suggestion.calendarEventId,
					// Something the person deleted once. Only ever present when the
					// caller asked for those back, and worth saying out loud rather
					// than re-proposing a deletion silently.
					previouslyDismissed: suggestion.dismissed,
					commits: suggestion.commits.map((commit) => ({
						projectGithubRepoId: commit.projectGithubRepoId,
						sha: commit.sha,
					})),
				})),
			};
		},
	},

	// ── reads: aggregates, absence, the close ───────────────────────────────
	{
		name: "time_report_summary",
		kind: "read",
		description:
			"Total logged hours over a date range, grouped by client, project or teammate. Scoped to what the caller is allowed to see. Use this for aggregate questions instead of listing every entry.",
		schema: timeReportSummaryInput,
		available: leadsSomething,
		run: async (ctx, args) => {
			const input = timeReportSummaryInput.parse(args);
			const result = await reportsService.timeSummary(ctx, input);
			return {
				rows: result.rows.map((row) => ({
					name: row.name,
					hours: row.secondsTotal / 3600,
				})),
				totalHours: result.totalSeconds / 3600,
				unfiledHours: result.unfiledSeconds / 3600,
			};
		},
	},
	{
		name: "time_report_detail",
		kind: "read",
		description:
			"The individual entries behind a report range — date, person, client, project, task, description, hours — with optional client, project, task and user filters. Use time_report_summary first; reach for this only when the question is about specific entries.",
		schema: timeReportDetailInput,
		available: leadsSomething,
		run: async (ctx, args) => {
			const input = timeReportDetailInput.parse(args);
			const result = await reportsService.timeDetail(ctx, input);
			return {
				rows: result.rows.map((row) => ({
					date: row.date,
					user: row.userName,
					client: row.clientName,
					project: row.projectName,
					task: row.taskName,
					description: row.description,
					hours: row.durationSeconds / 3600,
					overtime: row.overtime,
				})),
				// Both counts, always: the row list is capped and the totals are not,
				// so reporting only what came back understates the answer silently.
				totalRows: result.totalRows,
				totalHours: result.totalSeconds / 3600,
				truncated: result.truncated,
			};
		},
	},
	{
		name: "budget_burn",
		kind: "read",
		description:
			"Fixed Scope projects with their hour budget, hours consumed and burn percentage. Answers how much of a budget is left.",
		schema: z.object({}),
		available: leadsSomething,
		run: async (ctx) => {
			const rows = await reportsService.budgetBurn(ctx);
			return rows.map((row) => ({
				projectId: row.projectId,
				name: row.name,
				client: row.clientName,
				budgetHours: optionalHours(row.budgetSeconds),
				consumedHours: row.consumedSeconds / 3600,
				remainingHours: optionalHours(row.remainingSeconds),
				burnPct: row.burnPct,
			}));
		},
	},
	{
		name: "overtime_report",
		kind: "read",
		description:
			"Overtime hours per person for a month, with each person's running total for the year. Scoped to the caller's projects.",
		schema: monthReportInput,
		available: leadsSomething,
		run: async (ctx, args) => {
			const input = monthReportInput.parse(args);
			const rows = await reportsService.overtime(ctx, input);
			return rows.map((row) => ({
				userId: row.userId,
				name: row.name,
				monthHours: row.monthSeconds / 3600,
				yearHours: row.yearSeconds / 3600,
			}));
		},
	},
	{
		name: "unfiled_summary",
		kind: "read",
		description:
			"How much of the current user's logged time has no project attached yet, over a date range. Unfiled time blocks the monthly close.",
		schema: listTimeEntriesRangeInput,
		run: async (ctx, args) => {
			const input = listTimeEntriesRangeInput.parse(args);
			const totals = await unfiledTotals(ctx, input, ctx.userId);
			return { entries: totals.count, hours: totals.seconds / 3600 };
		},
	},
	{
		name: "absence_totals",
		kind: "read",
		description:
			"Absence taken in a year, grouped by task (Vacation, Sick Leave), in days and hours. Defaults to the current user; naming somebody else needs PM rights over a project they are on. This is the tool for 'how much vacation have I taken'.",
		schema: absenceTotalsInput,
		run: async (ctx, args) =>
			timeEntriesService.absenceTotals(ctx, absenceTotalsInput.parse(args)),
	},
	{
		name: "list_absences",
		kind: "read",
		description:
			"One person's Vacation and Sick Leave entries for a month, with their ids. Call whoami for the current user's own id.",
		schema: listAbsenceForUserInput,
		run: async (ctx, args) => {
			const input = listAbsenceForUserInput.parse(args);
			const rows = await timeEntriesService.listAbsenceForUser(ctx, input);
			return rows.map((row) => ({
				id: row.id,
				date: row.date,
				task: row.taskName,
				hours: row.durationSeconds / 3600,
				description: row.description,
			}));
		},
	},
	{
		name: "absence_report",
		kind: "read",
		description:
			"Organization-wide absence for a year, or for one month of it, per person and task. Admin only.",
		schema: absenceReportInput,
		available: adminOnly,
		run: async (ctx, args) =>
			reportsService.absence(ctx, absenceReportInput.parse(args)),
	},
	{
		name: "close_overview",
		kind: "read",
		description:
			"Every project the caller can close for one month, with its status (open, submitted, finalized), reported hours and final hours. Answers what is still open, and whether a month has been closed.",
		schema: monthReportInput,
		available: pmSomewhere,
		run: async (ctx, args) => {
			const { year, month } = monthReportInput.parse(args);
			const rows = await closeService.overview(ctx, year, month);
			return rows.map((row) => ({
				projectId: row.projectId,
				project: row.projectName,
				client: row.clientName,
				status: row.status,
				reportedHours: row.reportedSeconds / 3600,
				finalHours: optionalHours(row.finalSeconds),
				submittedAt: row.submittedAt?.toISOString() ?? null,
				finalizedAt: row.finalizedAt?.toISOString() ?? null,
			}));
		},
	},
	{
		name: "close_sheet",
		kind: "read",
		description:
			"The close sheet for one project and month: each person's Reported, Adjusted and Final hours, plus expected hours, overtime, unfiled time and absence days. Adjusted and Final are null when nobody has overridden them, which means they display as the column to their left. PM or Admin.",
		schema: closeSheetInput,
		available: pmSomewhere,
		run: async (ctx, args) => {
			const sheet = await closeService.getSheet(
				ctx,
				closeSheetInput.parse(args),
			);
			return {
				project: sheet.projectName,
				client: sheet.clientName,
				status: sheet.status,
				canEditAdjusted: sheet.canEditAdjusted,
				canEditFinal: sheet.canEditFinal,
				rows: sheet.rows.map((row) => ({
					userId: row.userId,
					name: row.name,
					reportedHours: row.reportedSeconds / 3600,
					// Nulls preserved rather than flattened to zero: an untouched row is
					// not a PM who reconciled to nothing, and the difference is the
					// whole reason the three columns exist.
					adjustedHours: optionalHours(row.adjustedSeconds),
					finalHours: optionalHours(row.finalSeconds),
					expectedHours: optionalHours(row.expectedSeconds),
					overtimeHours: row.overtimeSeconds / 3600,
					unfiledHours: row.unfiledSeconds / 3600,
					absenceDays: row.absenceDaysOverride ?? row.absenceDaysComputed,
					comment: row.comment,
				})),
			};
		},
	},

	// ── writes: create and correct, inline ──────────────────────────────────
	{
		name: "create_time_entry",
		kind: "write",
		description:
			"Log a new time entry for the current user. Durations are in seconds and must be a multiple of 900 (15 minutes). Needs a taskId; needs a projectId unless it is an absence.",
		schema: createTimeEntryInput,
		summarize: (_ctx, args) =>
			`Log ${hours(args.durationSeconds)} on ${args.date}${
				args.description ? ` — ${String(args.description).slice(0, 80)}` : ""
			}`,
		run: async (ctx, args) =>
			timeEntriesService.create(ctx, createTimeEntryInput.parse(args)),
	},
	{
		name: "update_time_entry",
		kind: "write",
		description:
			"Change an existing time entry of the current user. Send every field, not just the changed one. To change only the note, use update_entry_description.",
		schema: updateTimeEntryInput,
		summarize: (_ctx, args) =>
			`Change an entry on ${args.date} to ${hours(args.durationSeconds)}`,
		run: async (ctx, args) =>
			timeEntriesService.update(ctx, updateTimeEntryInput.parse(args)),
	},
	{
		name: "update_entry_description",
		kind: "write",
		description:
			"Change only the description of one of the current user's entries, leaving its hours, task and project alone.",
		schema: updateTimeEntryDescriptionInput,
		run: async (ctx, args) =>
			timeEntriesService.updateDescription(
				ctx,
				updateTimeEntryDescriptionInput.parse(args),
			),
	},
	{
		name: "set_overtime",
		kind: "write",
		description:
			"Flag one of the current user's entries as overtime, or clear the flag. Overtime is never inferred — somebody has to say so.",
		schema: setTimeEntryOvertimeInput,
		run: async (ctx, args) =>
			timeEntriesService.setOvertime(
				ctx,
				setTimeEntryOvertimeInput.parse(args),
			),
	},
	{
		name: "file_time_entries",
		kind: "write",
		description:
			"Attribute existing unfiled entries (synced meetings, commit blocks) to a project, by id. Get the ids from list_unfiled_entries. The user is shown the entries as a checklist and may file only some of them.",
		schema: fileTimeEntriesInput,
		summarize: async (ctx, args) => {
			const count = Array.isArray(args.timeEntryIds)
				? args.timeEntryIds.length
				: 0;
			const project = await nameOr(
				() => projectsService.get(ctx, String(args.projectId ?? "")),
				"a project",
			);
			return `File ${count === 1 ? "1 entry" : `${count} entries`} to ${project}`;
		},
		// The rows are the entries themselves, read back one by one through the
		// caller's own `getOwn` — which filters on ownership rather than throwing,
		// so an id the model invented drops out of the table instead of taking the
		// card down with it.
		preview: async (ctx, args) => {
			const ids = Array.isArray(args.timeEntryIds)
				? args.timeEntryIds.filter((id): id is string => typeof id === "string")
				: [];
			if (ids.length === 0) return null;
			const shown = ids.slice(0, MAX_PREVIEW_ROWS);
			const rows: ApprovalPreview["rows"] = [];
			for (const id of shown) {
				const entry = await timeEntriesService.getOwn(ctx, id);
				if (!entry) continue;
				rows.push({
					id,
					cells: [
						entry.date,
						hours(entry.durationSeconds),
						entry.description || entry.task?.name || "—",
					],
				});
			}
			if (rows.length === 0) return null;
			return {
				columns: ["Date", "Hours", "What"],
				rows,
				note:
					ids.length > shown.length
						? `+ ${ids.length - shown.length} more, not shown`
						: undefined,
			};
		},
		withSelection: (args, selected) => ({
			...args,
			timeEntryIds: Array.isArray(args.timeEntryIds)
				? args.timeEntryIds.filter(
						(id) => typeof id === "string" && selected.includes(id),
					)
				: [],
		}),
		run: async (ctx, args) =>
			timeEntriesService.fileMany(ctx, fileTimeEntriesInput.parse(args)),
	},
	{
		name: "copy_day",
		kind: "write",
		description:
			"Copy every entry from one day onto another for the current user — 'the same as yesterday'. Both dates are yyyy-MM-dd.",
		schema: copyTimeEntriesInput,
		summarize: (_ctx, args) =>
			`Copy ${args.fromDate}'s entries onto ${args.toDate}`,
		run: async (ctx, args) =>
			timeEntriesService.copyDay(ctx, copyTimeEntriesInput.parse(args)),
	},
	{
		name: "copy_week",
		kind: "write",
		description:
			"Copy a whole week of entries onto another week, pairing days by offset so last Tuesday lands on this Tuesday. Both arguments are the START date of a week.",
		schema: copyWeekEntriesInput,
		run: async (ctx, args) =>
			timeEntriesService.copyWeek(ctx, copyWeekEntriesInput.parse(args)),
	},
	{
		name: "log_absence",
		kind: "write",
		description:
			"Book Vacation or Sick Leave across a span of days for the current user. The span is expanded server-side: public holidays and days this person does not work are skipped, and each booked day takes that day's own working hours. Returns which days were booked and which were skipped and why — say so. Use this rather than one create_time_entry per day.",
		schema: logAbsenceRangeInput,
		summarize: (_ctx, args) => `Book absence from ${args.from} to ${args.to}`,
		run: async (ctx, args) =>
			timeEntriesService.logAbsenceRange(ctx, logAbsenceRangeInput.parse(args)),
	},
	{
		name: "apply_day_assembly",
		kind: "write",
		description:
			"Create a day's entries from suggestions returned by suggest_day. Pass through the taskId, projectId, description, durationSeconds, fillsDay, meetingUrl, calendarEventId and commits of each suggestion being accepted. The user is shown the entries as a checklist and may log only some of them.",
		schema: applyDayAssemblyInput,
		summarize: (_ctx, args) =>
			`Log ${Array.isArray(args.entries) ? args.entries.length : "several"} entries on ${args.date}`,
		// Rows are keyed by POSITION, because an assembled entry does not exist
		// yet and so has no id to key on. Position is stable for exactly as long
		// as it needs to be: the arguments the card was rendered from are the ones
		// stored on the message, and `withSelection` filters that same array.
		preview: async (ctx, args) => {
			const entries = Array.isArray(args.entries) ? args.entries : [];
			if (entries.length === 0) return null;
			// One list each rather than a lookup per row: fifty assembled entries
			// naming five tasks would otherwise be fifty queries for five answers.
			const [tasks, projects] = await Promise.all([
				tasksService.listSelectable(ctx).catch(() => []),
				projectsService.listMine(ctx).catch(() => []),
			]);
			const taskName = new Map(tasks.map((task) => [task.id, task.name]));
			const projectName = new Map(
				projects.map((project) => [project.id, project.name]),
			);
			const shown = entries.slice(0, MAX_PREVIEW_ROWS);
			return {
				columns: ["Task", "Project", "Hours", "Description"],
				rows: shown.map((entry, index) => {
					const row = (entry ?? {}) as Record<string, unknown>;
					const seconds = row.durationSeconds;
					return {
						id: String(index),
						cells: [
							taskName.get(String(row.taskId)) ?? "—",
							projectName.get(String(row.projectId)) ?? "No project",
							// A fill block carries no duration: it claims whatever is left
							// of the day, and printing "0h" for it would be a lie the person
							// is being asked to agree to.
							row.fillsDay ? "rest of day" : hours(seconds),
							String(row.description ?? "") || "—",
						],
					};
				}),
				note:
					entries.length > shown.length
						? `+ ${entries.length - shown.length} more, not shown`
						: undefined,
			};
		},
		withSelection: (args, selected) => {
			const picked = new Set(selected);
			return {
				...args,
				entries: Array.isArray(args.entries)
					? args.entries.filter((_entry, index) => picked.has(String(index)))
					: [],
			};
		},
		run: async (ctx, args) =>
			dayAssemblyService.apply(ctx, applyDayAssemblyInput.parse(args)),
	},
	{
		name: "attach_commits",
		kind: "write",
		description:
			"Attach GitHub commits to an existing time entry as evidence of what was worked on. Takes the projectGithubRepoId and sha pairs from list_commits.",
		schema: attachCommitsInput,
		run: async (ctx, args) =>
			githubService.attachCommits(ctx, attachCommitsInput.parse(args)),
	},
	{
		name: "create_client",
		kind: "write",
		description: "Create a client to hang projects off.",
		schema: createClientInput,
		available: canCreateProjects,
		run: async (ctx, args) =>
			clientsService.create(ctx, createClientInput.parse(args)),
	},
	{
		name: "create_project",
		kind: "write",
		description:
			"Create a project for a client. Needs a clientId (call list_clients) and a type: product_team, fixed_scope, hourly, maintenance or internal. Only Fixed Scope carries budgetHours; only Hourly carries hourlyPrice.",
		schema: createProjectInput,
		available: canCreateProjects,
		run: async (ctx, args) =>
			projectsService.create(ctx, createProjectInput.parse(args)),
	},
	{
		name: "update_project",
		kind: "write",
		description:
			"Change a project's name, code, colour, type or budget. Send the project type alongside any budget or price field.",
		schema: updateProjectInput,
		available: canCreateProjects,
		run: async (ctx, args) =>
			projectsService.update(ctx, updateProjectInput.parse(args)),
	},
	{
		name: "assign_project_member",
		kind: "write",
		description:
			"Put somebody on a project, or change their role on it (member, team_lead, pm). Team Lead and up.",
		schema: assignProjectMemberInput,
		available: leadsSomething,
		run: async (ctx, args) =>
			projectsService.assignMember(ctx, assignProjectMemberInput.parse(args)),
	},
	{
		name: "create_task",
		kind: "write",
		description:
			"Create an organization task type (the taxonomy every time entry is filed under, e.g. Development, QA). Not a to-do item. Admin only.",
		schema: createTaskInput,
		available: adminOnly,
		run: async (ctx, args) =>
			tasksService.create(ctx, createTaskInput.parse(args)),
	},
	{
		name: "update_task",
		kind: "write",
		description: "Rename or re-describe an organization task type. Admin only.",
		schema: updateTaskInput,
		available: adminOnly,
		run: async (ctx, args) =>
			tasksService.update(ctx, updateTaskInput.parse(args)),
	},
	{
		name: "create_recurring_block_rule",
		kind: "write",
		description:
			"Create a standing entry for the current user that materializes automatically — a daily break, a weekly stand-up. daysOfWeek is 0=Sunday..6=Saturday; duration is text such as '30m' or '1h30m'.",
		schema: createRecurringBlockRuleInput,
		run: async (ctx, args) =>
			recurringBlockRulesService.create(
				ctx,
				createRecurringBlockRuleInput.parse(args),
			),
	},
	{
		name: "update_recurring_block_rule",
		kind: "write",
		description: "Change one of the current user's recurring block rules.",
		schema: updateRecurringBlockRuleInput,
		run: async (ctx, args) =>
			recurringBlockRulesService.update(
				ctx,
				updateRecurringBlockRuleInput.parse(args),
			),
	},
	{
		name: "unarchive",
		kind: "write",
		description:
			"Bring an archived project, client or task type back into use. The counterpart to the archive tools.",
		// One tool over three ids rather than three near-identical tools. The
		// definition list is re-sent on every step of every turn, and "which of
		// these three is it" is a parameter the model answers exactly as reliably
		// as it picks between three tool names.
		schema: z.object({
			kind: z.enum(["project", "client", "task"]),
			id: z.uuid(),
		}),
		run: async (ctx, args) => {
			const { kind, id } = z
				.object({ kind: z.enum(["project", "client", "task"]), id: z.uuid() })
				.parse(args);
			if (kind === "project") return projectsService.unarchive(ctx, id);
			if (kind === "client") return clientsService.unarchive(ctx, id);
			return tasksService.unarchive(ctx, id);
		},
	},
	{
		name: "close_save_row",
		kind: "write",
		description:
			"Set the Adjusted hours, absence-day override or comment on one person's row of a close sheet. Adjusted is the PM's reconciliation of what Reported says; null clears it back to Reported. PM or Admin.",
		schema: saveCloseRowInput,
		available: pmSomewhere,
		run: async (ctx, args) =>
			closeService.saveRow(ctx, saveCloseRowInput.parse(args)),
	},
	{
		name: "close_set_final",
		kind: "write",
		description:
			"Set the Final hours on one person's row — the number that gets invoiced. Null clears it back to Adjusted. Admin only.",
		schema: setCloseRowFinalInput,
		available: adminOnly,
		run: async (ctx, args) =>
			closeService.setFinal(ctx, setCloseRowFinalInput.parse(args)),
	},
	{
		name: "close_submit",
		kind: "write",
		description:
			"Submit a project's month for an Admin to finalize. Reversible: a PM may re-open and re-submit freely until it is finalized. PM or Admin.",
		schema: closeTransitionInput,
		available: pmSomewhere,
		run: async (ctx, args) =>
			closeService.submit(ctx, closeTransitionInput.parse(args)),
	},

	// ── destructive: suspends the turn for approval ─────────────────────────
	{
		name: "delete_time_entry",
		kind: "destructive",
		description: "Delete one of the current user's time entries by id.",
		schema: z.object({ timeEntryId: deleteTimeEntryInput }),
		summarize: async (ctx, args) => {
			const row = await timeEntriesService
				.getOwn(ctx, String(args.timeEntryId))
				.catch(() => null);
			if (!row) return "Delete a time entry";
			const what = row.description?.trim() || row.task?.name || "entry";
			return `Delete ${hours(row.durationSeconds)} on ${row.date} — ${what.slice(0, 60)}`;
		},
		run: async (ctx, args) => {
			const { timeEntryId } = z
				.object({ timeEntryId: deleteTimeEntryInput })
				.parse(args);
			// `remove` is a delete-where-owned: an entry belonging to somebody else
			// (or already gone) is a no-op returning null, not a throw. Reporting a
			// flat `{deleted: true}` would have the model tell the user it deleted
			// something it did not touch, which is the one failure mode a write tool
			// must not have.
			const removed = await timeEntriesService.remove(ctx, timeEntryId);
			if (!removed) {
				throw new Error("No entry of yours with that id — nothing was deleted");
			}
			return { deleted: true, date: removed.date };
		},
	},
	{
		name: "remove_absence",
		kind: "destructive",
		description:
			"Delete a Vacation or Sick Leave entry by id. Deleting somebody else's needs PM rights over a project they are on.",
		schema: z.object({ timeEntryId: deleteTimeEntryInput }),
		summarize: async (ctx, args) => {
			// Own entries only, so somebody else's absence falls back to the generic
			// wording rather than leaking whose day it was into the caller's card.
			const row = await timeEntriesService
				.getOwn(ctx, String(args.timeEntryId))
				.catch(() => null);
			return row
				? `Delete ${row.task?.name ?? "absence"} on ${row.date}`
				: "Delete an absence entry";
		},
		run: async (ctx, args) => {
			const { timeEntryId } = z
				.object({ timeEntryId: deleteTimeEntryInput })
				.parse(args);
			const removed = await timeEntriesService.removeAbsence(ctx, timeEntryId);
			return { deleted: true, date: removed.date };
		},
	},
	{
		name: "delete_recurring_block_rule",
		kind: "destructive",
		description:
			"Delete one of the current user's recurring block rules so it stops producing entries. Entries it already created are left alone.",
		schema: z.object({ ruleId: deleteRecurringBlockRuleInput }),
		summarize: async (ctx, args) => {
			const rules = await recurringBlockRulesService.list(ctx).catch(() => []);
			const rule = rules.find((row) => row.id === args.ruleId);
			if (!rule) return "Delete a recurring block rule";
			const what = rule.description?.trim() || rule.task?.name || "block";
			return `Stop the recurring ${what.slice(0, 60)}`;
		},
		run: async (ctx, args) => {
			const { ruleId } = z
				.object({ ruleId: deleteRecurringBlockRuleInput })
				.parse(args);
			return recurringBlockRulesService.remove(ctx, ruleId);
		},
	},
	{
		name: "archive_project",
		kind: "destructive",
		description:
			"Archive a project. It stops accepting time and leaves the pickers; its history is kept.",
		schema: z.object({ projectId: projectIdInput }),
		summarize: async (ctx, args) =>
			`Archive ${await nameOr(
				() => projectsService.get(ctx, String(args.projectId)),
				"a project",
			)}`,
		run: async (ctx, args) => {
			const { projectId } = z.object({ projectId: projectIdInput }).parse(args);
			return projectsService.archive(ctx, projectId);
		},
	},
	{
		name: "archive_client",
		kind: "destructive",
		description:
			"Archive a client, hiding it and its projects from the pickers.",
		schema: z.object({ clientId: clientIdInput }),
		summarize: async (ctx, args) =>
			`Archive ${await nameOr(async () => {
				const clients = await clientsService.list(ctx);
				return clients.find((row) => row.id === args.clientId);
			}, "a client")} and its projects`,
		run: async (ctx, args) => {
			const { clientId } = z.object({ clientId: clientIdInput }).parse(args);
			return clientsService.archive(ctx, clientId);
		},
	},
	{
		name: "archive_task",
		kind: "destructive",
		description:
			"Archive an organization task type so no new time can be filed under it. Admin only.",
		schema: z.object({ taskId: taskIdInput }),
		available: adminOnly,
		summarize: async (ctx, args) =>
			`Archive the ${await nameOr(async () => {
				const tasks = await tasksService.listSelectable(ctx);
				return tasks.find((row) => row.id === args.taskId);
			}, "selected")} task type`,
		run: async (ctx, args) => {
			const { taskId } = z.object({ taskId: taskIdInput }).parse(args);
			return tasksService.archive(ctx, taskId);
		},
	},
	{
		name: "close_finalize",
		kind: "destructive",
		description:
			"Finalize a project's month. Freezes the reported, expected and overtime figures the variance report is read against, and refuses while anybody still has unfiled time. Admin only.",
		schema: closeTransitionInput,
		available: adminOnly,
		summarize: async (ctx, args) =>
			`Finalize ${await nameOr(
				() => projectsService.get(ctx, String(args.projectId)),
				"a project",
			)} for ${args.month}/${args.year} — this freezes the invoiced figures`,
		run: async (ctx, args) =>
			closeService.finalize(ctx, closeTransitionInput.parse(args)),
	},
	{
		name: "close_reopen",
		kind: "destructive",
		description:
			"Re-open a project's month. A PM may re-open their own submission; only an Admin may re-open a month that was finalized. The finalize snapshots are deliberately kept.",
		schema: closeTransitionInput,
		available: pmSomewhere,
		summarize: async (ctx, args) =>
			`Re-open ${await nameOr(
				() => projectsService.get(ctx, String(args.projectId)),
				"a project",
			)} for ${args.month}/${args.year}`,
		run: async (ctx, args) =>
			closeService.reopen(ctx, closeTransitionInput.parse(args)),
	},
];

const BY_NAME = new Map(ASSISTANT_TOOLS.map((tool) => [tool.name, tool]));

export const findTool = (name: string): AssistantTool | undefined =>
	BY_NAME.get(name);

/** The tools this caller is offered at all. See `AssistantTool.available`. */
export const toolsFor = (access: Access): AssistantTool[] =>
	ASSISTANT_TOOLS.filter((tool) => tool.available?.(access) ?? true);

/** The tool list in OpenAI's function-calling shape, scoped to the caller. */
export const toolDefinitions = (access: Access) =>
	toolsFor(access).map((tool) => ({
		type: "function" as const,
		function: {
			name: tool.name,
			description: tool.description,
			parameters: z.toJSONSchema(tool.schema, {
				// The schemas use `.refine()` for the range ceilings and the
				// mandatory-description rule, which have no JSON Schema equivalent.
				// Emitting them as `{}` (rather than throwing) keeps the shape the
				// model sees honest about the fields while leaving enforcement where
				// it actually happens — the `parse` inside each tool's `run`.
				io: "input",
				unrepresentable: "any",
			}) as Record<string, unknown>,
		},
	}));

/**
 * The system prompt.
 *
 * Dated and zoned explicitly because every question this assistant gets is
 * relative ("last week", "yesterday") and a model with no date silently anchors
 * on its training cutoff — which produces entries filed months into the past,
 * quietly, onto months that may already be closed.
 *
 * `houseRules` is the org's own addition (assistantSettings.systemPrompt),
 * APPENDED rather than substituted, fenced, and explicitly ranked below the
 * rules above it. An admin is trusted — they already hold the API key and the
 * close sheet — so this is not a security boundary. It is a precedence one: the
 * base rules encode facts about the DOMAIN (quarter-hour granularity, ids are
 * looked up not invented, deletes need consent) that stay true no matter what
 * conventions an org layers on top, and a pasted paragraph that happens to
 * contradict one of them should lose rather than silently win.
 */
export const systemPrompt = async (
	ctx: Ctx,
	today: string,
	houseRules?: string | null,
) => {
	const tz = await ctxTimezone(ctx);
	const base = [
		"You are the assistant inside Farmer, a time-tracking app for a software agency.",
		`Today is ${today} in the organization's timezone (${tz}). Resolve every relative date against that.`,
		"",
		"You answer questions about the user's tracked time and act on their behalf: logging and correcting time, booking absence, working the month-end close, and creating clients, projects and task types. Everything you do runs as them and with their permissions, so a tool that refuses is a real answer about what they are allowed to do — report it, don't work around it. You are only offered the tools their role allows, so there is nothing to try around the edges.",
		"Rules:",
		"- Durations are seconds, always a multiple of 900 (15 minutes). Round to the nearest quarter hour and say that you did.",
		"- Never invent an id. Call list_projects / list_tasks / list_clients / list_members first and use what comes back. whoami gives the current user's own id.",
		"- Prefer an aggregate over a list: time_report_summary for hours by client, project or teammate; absence_totals for vacation taken; close_overview for what is still open.",
		"- Creating and correcting things happens immediately, so just do what was asked rather than checking first. Deleting, archiving, finalizing and re-opening are shown to the user for approval — still call the tool, they will be asked.",
		"- Batch writes (apply_day_assembly, file_time_entries) are shown as a checklist of their rows and the user may approve only some. Send the whole batch you believe in and let them un-tick; the tool result says what was actually written, so read it before reporting what you did.",
		"- Reconstructing a day: suggest_day already assembles it from meetings, commits and recurring blocks, so prefer it and then apply_day_assembly. Use list_commits and list_time_entries when you need the raw evidence. Do not log the same work twice.",
		"- Absence spanning several days goes through log_absence once, not one entry per day. It skips holidays and non-working days itself, so report which days it actually booked.",
		"- If a tool returns an error, explain what went wrong in one sentence rather than retrying blindly.",
		"- Be brief. This is a sidebar, not an essay.",
		"",
		// The renderer is apps/web/src/components/assistant/answer.tsx and it is
		// hand-rolled, so this list is exhaustive rather than "markdown" — a
		// construct it doesn't know renders to the reader as its own syntax.
		// Keep the two in step when either changes.
		"Formatting. Your answer is rendered as markdown, and only these are understood: paragraphs, `#`/`##`/`###` headings, bullet and numbered lists, **bold**, *italic*, `inline code`, fenced code blocks, links, `---` rules, and GitHub-style pipe tables. Anything else arrives as literal characters.",
		"- Any answer that is more than one number per row is a table: hours by project, a week day by day, entries you changed. Include the header separator row (`|---|---:|`) or it is not a table; right-align (`---:`) columns of numbers.",
		"- Keep tables to the columns that were asked about, and put the total in a last row rather than in a sentence underneath.",
		"- One or two facts is a sentence, not a table, and not a heading.",
		// Three things that are NOT markdown, and are the only UI the model may
		// place. Spelled out with their exact syntax because a directive the
		// renderer doesn't recognise degrades to a visible code block — legible,
		// but obviously wrong. See answer.tsx, which must gain a construct before
		// this prompt promises one.
		"- Cite a day as [[YYYY-MM-DD]] and it becomes a link to that day's timesheet. Use it wherever you name a date the reader might want to check — it is how they see the entries a figure was summed from.",
		'- To draw a chart, emit a fenced block tagged farmer-chart holding JSON: {"type":"bar"|"trend","title":"…","unit":"h","data":[{"label":"…","value":12.5}]}. `bar` compares categories (projects, people), `trend` runs left to right in time (days, months). Hours as decimal hours, not seconds. Max 40 points. A chart replaces a long table when the SHAPE is the answer; a chart plus its table is duplication, so pick one.',
		'- END EVERY ANSWER with a fenced block tagged farmer-next holding two or three follow-ups, one per line, each phrased as the user would type it ("File Tuesday\'s meeting to Harbor App"). They are the next move, not a menu: draw them from what you just said and what the data showed — the project that stood out, the day that is short, the entries still unfiled — and only offer things you could actually do. Generic ones ("Tell me more") are worse than none, so if nothing specific suggests itself, offer the nearest concrete actions instead.',
	];

	const rules = houseRules?.trim();
	if (!rules) return base.join("\n");

	return [
		...base,
		"",
		"The organization's own conventions follow. Apply them where they add to the rules above; where they conflict with anything above, the rules above win.",
		"<house-rules>",
		rules,
		"</house-rules>",
	].join("\n");
};
