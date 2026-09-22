import { summarizeCommitMessages } from "@farmer/core/lib/day-plan";
import { describePullRequestActivity } from "@farmer/core/lib/github-activity";
import { descriptionRequiredFor } from "@farmer/core/lib/task-rules";
import {
	addDaysToKey,
	parseDuration,
	snapToQuarterHour,
	timeKeyInTz,
	weekdayInTz,
} from "@farmer/core/lib/time";
import { zodResolver } from "@hookform/resolvers/zod";
import {
	ArrowLeftIcon,
	ArrowRightIcon,
	CalendarDotIcon,
	CaretRightIcon,
	GitCommitIcon,
	GitPullRequestIcon,
	VideoCameraIcon,
	XIcon,
} from "@phosphor-icons/react";
import {
	useMutation,
	useQuery,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { ProjectPicker } from "#/components/pickers/project-picker.tsx";
import { TaskPicker } from "#/components/pickers/task-picker.tsx";
import { DateJump, stepperClass } from "#/components/time/time-toolbar.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { DatePicker } from "#/components/ui/date-picker.tsx";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "#/components/ui/dialog.tsx";
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "#/components/ui/form.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Switch } from "#/components/ui/switch.tsx";
import { Textarea } from "#/components/ui/textarea.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { useWeekdays } from "#/hooks/use-week-starts-on.ts";
import {
	readEntryOptions,
	readLastPick,
	rememberEntryOptions,
	rememberLastPick,
} from "#/lib/entry-options.ts";
import { formatDateKeyLong } from "#/lib/format-date.ts";
import { formatClock } from "#/lib/format-hours.ts";
import { useHeightTransition } from "#/lib/motion.ts";
import { cn } from "#/lib/utils.ts";
import {
	attachedCommitsQuery,
	attachedPullRequestsQuery,
	githubConnectionStatusQuery,
	projectGithubReposQuery,
	suggestedCommitsQuery,
	suggestedPullRequestsQuery,
} from "#/queries/github.ts";
import {
	calendarEventsForDayQuery,
	googleCalendarStatusQuery,
} from "#/queries/google-calendar.ts";
import { integrationSettingsQuery } from "#/queries/integration-settings.ts";
import { queryKeys } from "#/queries/keys.ts";
import { myProjectsQuery } from "#/queries/projects.ts";
import { recurringBlockRulesQuery } from "#/queries/recurring-block-rules.ts";
import { recentTasksQuery, tasksForProjectQuery } from "#/queries/tasks.ts";
import { timeEntriesRangeQuery } from "#/queries/time-entries.ts";
import {
	attachCommitsToEntry,
	attachPullRequestsToEntry,
	detachCommitFromEntry,
	detachPullRequestFromEntry,
	suggestCommitsForEntry,
	suggestPullRequestsForEntry,
} from "#/server/github.ts";
import type { listCalendarEventsForDay } from "#/server/google-calendar.ts";
import { createRecurringBlockRule } from "#/server/recurring-block-rules.ts";
import { createTimeEntry, updateTimeEntry } from "#/server/time-entries.ts";

// Time off is chosen where a project would be: it sits first in the project
// picker, and choosing it narrows the task list to the leave kinds.
const TIME_OFF = "__time_off__";
// An entry that has no project YET — a synced meeting, a rest-of-day block —
// opened for editing. Not Time-off: it is worked time whose project question
// is still open, and it may be saved with the question still open. Opening
// such an entry as Time-off narrowed the tasks to the leave kinds, so
// "Meeting" vanished from its own entry and the only way to change its day or
// note was to pick a project and a task first.
const NO_PROJECT_YET = "__no_project_yet__";

export type ExistingTimeEntry = {
	id: string;
	date: string;
	projectId: string | null;
	taskId: string;
	/** Whether the task is a leave kind. Read only to tell a project-less
	 *  worked entry (still unfiled) from time off, which has no project by
	 *  definition. Absent: assume time off, the older behaviour. */
	task?: { isAbsence: boolean };
	description: string;
	durationSeconds: number;
	overtime: boolean;
	fillsDay: boolean;
	generatedFromRuleId: string | null;
};

const MAX_ENTRY_SECONDS = 24 * 3600;

/** The lengths most entries actually are, offered as a row under the field.
 *
 *  Written as clock strings because that is what the field holds and what its
 *  blur handler normalises to, so a preset and a typed "1.5" end in one state
 *  rather than two that only look alike.
 *
 *  Four, not seven. "Rest of day" sits beside them as a fifth and is not one of
 *  these: it is a different KIND of answer — a block sized from whatever the
 *  day has left rather than a number — which is why it is set apart, and why it
 *  came out of More options, where nobody found it. */
const QUICK_DURATIONS = ["0:30", "1:00", "2:00", "4:00"] as const;

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected yyyy-MM-dd");

const formSchema = z
	.object({
		projectId: z.string().min(1),
		taskId: z.uuid("Required"),
		date: dateKey,
		duration: z.string(),
		description: z.string().max(10_000),
		overtime: z.boolean(),
		fillsDay: z.boolean(),
		repeatEnabled: z.boolean(),
		daysOfWeek: z.array(z.number().int().min(0).max(6)),
		repeatEndDate: z.string(),
	})
	.superRefine((data, ctx) => {
		if (!data.fillsDay) {
			if (!data.duration.trim()) {
				ctx.addIssue({
					code: "custom",
					path: ["duration"],
					message: "Required",
				});
			} else {
				const parsed = parseDuration(data.duration);
				if (parsed === null) {
					ctx.addIssue({
						code: "custom",
						path: ["duration"],
						message: "Try 1.5 or 1:30",
					});
				} else if (parsed <= 0) {
					ctx.addIssue({
						code: "custom",
						path: ["duration"],
						message: "Required",
					});
				} else if (snapToQuarterHour(parsed) > MAX_ENTRY_SECONDS) {
					ctx.addIssue({
						code: "custom",
						path: ["duration"],
						message: "Max 24 hours",
					});
				}
			}
		}
		if (data.repeatEnabled && data.daysOfWeek.length < 1) {
			ctx.addIssue({
				code: "custom",
				path: ["daysOfWeek"],
				message: "Pick a day",
			});
		}
	});

type FormValues = z.infer<typeof formSchema>;

function commitKey(projectGithubRepoId: string, sha: string): string {
	return `${projectGithubRepoId}:${sha}`;
}

function pullRequestKey(projectGithubRepoId: string, number: number): string {
	return `${projectGithubRepoId}:${number}`;
}

type ActivityKind = "opened" | "merged" | "closed" | "reviewed";
type ReviewState = "approved" | "changes_requested" | "commented" | "dismissed";

function activityLabel(
	kind: ActivityKind,
	reviewState: ReviewState | null,
): string {
	if (kind === "opened") return "Opened";
	if (kind === "merged") return "Merged";
	if (kind === "closed") return "Closed";
	switch (reviewState) {
		case "approved":
			return "Reviewed (approved)";
		case "changes_requested":
			return "Reviewed (changes requested)";
		case "commented":
			return "Reviewed (commented)";
		case "dismissed":
			return "Reviewed (dismissed)";
		default:
			return "Reviewed";
	}
}

// Distinct activity labels in first-seen order, joined into one line — a PR
// opened and then reviewed twice reads as "Opened · Reviewed (approved)", not
// three repeated words.
function activitySummary(
	events: Array<{ kind: ActivityKind; reviewState: ReviewState | null }>,
): string {
	const labels: string[] = [];
	for (const event of events) {
		const label = activityLabel(event.kind, event.reviewState);
		if (!labels.includes(label)) labels.push(label);
	}
	return labels.join(" · ");
}

export function AddBlockDialog({
	timezone,
	defaultDate: defaultDateProp,
	defaultProjectId,
	entry,
	trigger,
}: {
	timezone: string;
	/** The day the dialog opens on; the stepper in its header moves from there.
	 *  An existing entry opens on its own day. */
	defaultDate: string;
	/** Opened from a project's own page: that project, already chosen. */
	defaultProjectId?: string;
	entry?: ExistingTimeEntry;
	trigger: React.ReactElement;
}) {
	const orgSlug = useOrgSlug();
	// The three disclosures below all open by changing their HEIGHT, which the
	// root <MotionConfig reducedMotion="user"> does not touch — see the hook.
	const heightTransition = useHeightTransition();
	const [open, setOpen] = useState(false);
	const queryClient = useQueryClient();
	const { data: projects } = useSuspenseQuery(myProjectsQuery(orgSlug));

	const defaultDate = entry?.date ?? defaultDateProp;

	const unfiledEdit =
		!!entry && entry.projectId == null && entry.task?.isAbsence === false;

	const buildDefaults = (): FormValues => ({
		projectId:
			entry?.projectId ??
			(unfiledEdit ? NO_PROJECT_YET : (defaultProjectId ?? TIME_OFF)),
		taskId: entry?.taskId ?? "",
		date: defaultDate,
		duration: entry ? formatClock(entry.durationSeconds) : "",
		description: entry?.description ?? "",
		overtime: entry?.overtime ?? false,
		fillsDay: entry?.fillsDay ?? false,
		repeatEnabled: false,
		daysOfWeek: [weekdayInTz(defaultDate, timezone)],
		repeatEndDate: "",
	});

	const form = useForm<FormValues>({
		resolver: zodResolver(formSchema),
		defaultValues: buildDefaults(),
	});

	// A new entry opens on the project + task last logged, while that project can
	// still take time. Opened from a project's own page, the page's project wins
	// and the task comes along only if it was picked there. The task itself is
	// not checked here: the effect below clears one the project no longer offers.
	// Read on open rather than in `buildDefaults`, which also runs on the server.
	const rememberedPick = (): Partial<FormValues> => {
		if (entry) return {};
		const last = readLastPick("entry", orgSlug);
		if (!last) return {};
		if (defaultProjectId) {
			return last.projectId === defaultProjectId ? { taskId: last.taskId } : {};
		}
		const live = projects.some(
			(p) => p.id === last.projectId && p.status === "active",
		);
		return live ? last : {};
	};

	/* oxlint-disable react-hooks/exhaustive-deps -- only reset when the dialog opens */
	useEffect(() => {
		if (!open) return;
		form.reset({ ...buildDefaults(), ...rememberedPick() });
	}, [open]);
	/* oxlint-enable react-hooks/exhaustive-deps */

	const projectId = form.watch("projectId");
	const taskId = form.watch("taskId");
	const targetDate = form.watch("date") || defaultDate;
	const repeatEnabled = form.watch("repeatEnabled");
	const fillsDay = form.watch("fillsDay");
	const daysOfWeek = form.watch("daysOfWeek");
	const weekdays = useWeekdays();

	// The task list follows the project: with one it is the whole grouped list,
	// without one the short project-less list (time off and the built-ins). Every
	// project offers the same list, so the task survives a switch between them;
	// crossing into or out of Time-off is what can leave one that no longer
	// applies, and the effect below lets that one go.
	const { data: tasks = [] } = useQuery({
		...tasksForProjectQuery(
			orgSlug,
			projectId === TIME_OFF || projectId === NO_PROJECT_YET
				? undefined
				: projectId,
		),
		enabled: open,
	});
	const { data: recentIds = [] } = useQuery({
		...recentTasksQuery(orgSlug, projectId),
		enabled: open && projectId !== TIME_OFF && projectId !== NO_PROJECT_YET,
	});
	const isTimeOff = projectId === TIME_OFF;
	const hasProject = projectId !== TIME_OFF && projectId !== NO_PROJECT_YET;
	// Under Time-off only the leave kinds are offered; Break and Meeting are
	// logged on a project like everything else.
	const pickableTasks = isTimeOff ? tasks.filter((t) => t.isAbsence) : tasks;
	const selectedTask = tasks.find((t) => t.id === taskId);
	useEffect(() => {
		if (!taskId) return;
		if (
			pickableTasks.length > 0 &&
			!pickableTasks.some((t) => t.id === taskId)
		) {
			form.setValue("taskId", "");
		}
	}, [pickableTasks, taskId, form]);

	// Worked time must say what was done; time off and a Break need not. The
	// task decides, and the rule is asked at submit against the task chosen
	// then — not stored on the form, where a value set by an effect went stale
	// across a reopen and demanded a note the label had just called optional.
	const needsDescription = selectedTask
		? descriptionRequiredFor(selectedTask)
		: true;

	// An absence task (Vacation / Sick Leave) is logged against no project and
	// needs no note; picking one clears any project already chosen.
	const isAbsence = !!selectedTask?.isAbsence;
	useEffect(() => {
		if (isAbsence && form.getValues("projectId") !== TIME_OFF) {
			form.setValue("projectId", TIME_OFF);
		}
	}, [isAbsence, form]);

	// Duration is typed, not derived: there is no clock in this system, so an
	// entry is a date plus an amount of time, in 15-minute steps.
	//
	// The rounding used to be announced under the field ("Rounds to 1:30 — time
	// is tracked in 15-minute steps"), which is a paragraph of small print under
	// a box that has just demonstrated the rule. The blur IS the feedback: you
	// type 1.5 and you watch 1:30 appear. `snapToQuarterHour` does it there and
	// again in the validator, and it floors at 15 minutes, so "0.1" becomes a
	// real block rather than a 0 the server then rejects with a toast.
	//
	// Read so a preset can light up when the field already holds its value.
	const durationValue = form.watch("duration");

	const { data: dayEntries } = useQuery({
		...timeEntriesRangeQuery(orgSlug, targetDate, targetDate),
		enabled: open && !entry,
	});

	// The server allows one fill block per user/day, so a second one is a
	// guaranteed rejection — grey the toggle out up front instead of letting
	// the submit bounce. Editing keeps the toggle live (the existing fill
	// block itself is the one legitimate case).
	const dayHasFill = !entry && (dayEntries ?? []).some((e) => e.fillsDay);
	useEffect(() => {
		if (dayHasFill && form.getValues("fillsDay")) {
			form.setValue("fillsDay", false);
		}
	}, [dayHasFill, form]);

	// A project + task opens with the options it was last saved with. Only a new
	// entry is prefilled — an edit shows what the entry holds — and leaving the
	// combination (another task, another project, Time-off, where the switches
	// are hidden but still submitted) takes the prefill back out.
	const prefilledRef = useRef(false);
	useEffect(() => {
		if (entry || !open) return;
		const remembered =
			!isTimeOff && taskId
				? readEntryOptions(orgSlug, projectId, taskId)
				: null;
		if (remembered) {
			form.setValue("fillsDay", remembered.fillsDay && !dayHasFill);
			form.setValue("overtime", remembered.overtime);
			prefilledRef.current = true;
		} else if (prefilledRef.current) {
			form.setValue("fillsDay", false);
			form.setValue("overtime", false);
			prefilledRef.current = false;
		}
	}, [entry, open, isTimeOff, orgSlug, projectId, taskId, dayHasFill, form]);

	const { data: githubStatus } = useQuery({
		...githubConnectionStatusQuery(orgSlug),
		enabled: open,
	});
	const { data: googleStatus } = useQuery({
		...googleCalendarStatusQuery(orgSlug),
		enabled: open,
	});
	const { data: linkedRepos } = useQuery({
		...projectGithubReposQuery(orgSlug, projectId),
		enabled: open && hasProject,
	});
	const { data: attachedCommits } = useQuery({
		...attachedCommitsQuery(orgSlug, entry?.id ?? ""),
		enabled: open && !!entry,
	});
	const { data: attachedPullRequests } = useQuery({
		...attachedPullRequestsQuery(orgSlug, entry?.id ?? ""),
		enabled: open && !!entry,
	});
	const { data: integrationSettings } = useQuery({
		...integrationSettingsQuery(orgSlug),
		enabled: open,
	});
	// One toggle covers both: it auto-loads the day's commits and its pull
	// request activity into the picker below, no "Find activity" click.
	const autoLoadCommits = !!integrationSettings?.githubAutoLoadCommits;

	const [suggestedCommits, setSuggestedCommits] = useState<
		Awaited<ReturnType<typeof suggestCommitsForEntry>>
	>([]);
	const [selectedCommitKeys, setSelectedCommitKeys] = useState<Set<string>>(
		new Set(),
	);
	const [suggestedPullRequests, setSuggestedPullRequests] = useState<
		Awaited<ReturnType<typeof suggestPullRequestsForEntry>>
	>([]);
	const [selectedPullRequestKeys, setSelectedPullRequestKeys] = useState<
		Set<string>
	>(new Set());
	useEffect(() => {
		if (!open) return;
		setSuggestedCommits([]);
		setSelectedCommitKeys(new Set());
		setSuggestedPullRequests([]);
		setSelectedPullRequestKeys(new Set());
	}, [open]);

	// Two different questions, and conflating them hid the commits on exactly the
	// entries that always have some. FINDING new activity needs a project and a
	// date to look it up by, and makes no sense on a rest-of-day fill block whose
	// commits the engine already attached. SHOWING what is attached needs nothing
	// but the attachments — a project-less fill block is the commit engine's own
	// output, so it is the one entry guaranteed to have them. Pull requests share
	// the same gate: a repo linked for commits is the same repo a PR lives in.
	const showCommitPicker =
		!repeatEnabled &&
		!fillsDay &&
		hasProject &&
		!!githubStatus?.connected &&
		!!linkedRepos &&
		linkedRepos.length > 0;
	const showAttachedCommits =
		!repeatEnabled && !!attachedCommits && attachedCommits.length > 0;

	// With auto-load on, the day's commits populate the picker as soon as it's
	// relevant — no "Find commits" click. When off, the manual mutation below is
	// the only source and this query stays disabled.
	const suggestedCommitsQ = useQuery({
		...suggestedCommitsQuery(orgSlug, projectId, targetDate),
		enabled: open && showCommitPicker && autoLoadCommits,
	});

	// One list feeds the picker regardless of how it was populated: the auto-load
	// query when the toggle is on, the manual mutation's result otherwise.
	const effectiveSuggested = autoLoadCommits
		? (suggestedCommitsQ.data ?? [])
		: suggestedCommits;

	const attachedShas = new Set((attachedCommits ?? []).map((c) => c.sha));
	const pickableCommits = effectiveSuggested.filter(
		(c) => !attachedShas.has(c.sha),
	);

	// Ticking activity writes the description from it, the way the commit engine
	// writes its own blocks' — but only into a box that is empty or still holds
	// what the last tick wrote. The ref is that last write: once the person types
	// over it, the text is theirs and further ticks leave it alone.
	const autoDescriptionRef = useRef<string | null>(null);
	useEffect(() => {
		if (open) autoDescriptionRef.current = null;
	}, [open]);
	const describeSelection = (
		commitKeys: Set<string>,
		pullRequestKeys: Set<string>,
	) => {
		const current = form.getValues("description");
		if (current.trim() && current !== autoDescriptionRef.current) return;
		const next = summarizeCommitMessages([
			...effectiveSuggested
				.filter((c) => commitKeys.has(commitKey(c.projectGithubRepoId, c.sha)))
				.map((c) => c.message),
			...describePullRequestActivity(
				effectiveSuggestedPullRequests
					.filter((pr) =>
						pullRequestKeys.has(
							pullRequestKey(pr.projectGithubRepoId, pr.number),
						),
					)
					.flatMap((pr) =>
						pr.activity.map((a) => ({
							kind: a.kind,
							number: pr.number,
							title: pr.title,
						})),
					),
			),
		]);
		autoDescriptionRef.current = next;
		if (next === current) return;
		form.setValue("description", next);
		if (next) form.clearErrors("description");
	};

	const toggleCommitSelection = (key: string) => {
		const next = new Set(selectedCommitKeys);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		setSelectedCommitKeys(next);
		describeSelection(next, selectedPullRequestKeys);
	};

	const suggestCommitsMutation = useMutation({
		mutationFn: () =>
			suggestCommitsForEntry({ data: { projectId, date: targetDate } }),
		onSuccess: (commits) => setSuggestedCommits(commits),
		onError: (error) => {
			toast.error(error.message ?? "Could not fetch commits");
		},
	});

	const detachCommitMutation = useMutation({
		mutationFn: (timeEntryGithubCommitId: string) =>
			detachCommitFromEntry({ data: timeEntryGithubCommitId }),
		onSuccess: async () => {
			if (!entry) return;
			await queryClient.invalidateQueries({
				queryKey: attachedCommitsQuery(orgSlug, entry.id).queryKey,
			});
		},
		onError: (error) => {
			toast.error(error.message ?? "Could not remove commit");
		},
	});

	// Attached pull-request activity is one row per event (an entry attached to
	// a PR that was both opened and reviewed here has two rows), so it is
	// grouped by `pullRequestUrl` before it is shown — one line per PR, with
	// every event that touched it summarised on that line.
	const attachedPullRequestGroups = (() => {
		const groups = new Map<
			string,
			{
				pullRequestUrl: string;
				number: number;
				title: string;
				ids: string[];
				events: Array<{ kind: ActivityKind; reviewState: ReviewState | null }>;
			}
		>();
		for (const row of attachedPullRequests ?? []) {
			const existing = groups.get(row.pullRequestUrl);
			if (existing) {
				existing.ids.push(row.id);
				existing.events.push({ kind: row.kind, reviewState: row.reviewState });
			} else {
				groups.set(row.pullRequestUrl, {
					pullRequestUrl: row.pullRequestUrl,
					number: row.number,
					title: row.title,
					ids: [row.id],
					events: [{ kind: row.kind, reviewState: row.reviewState }],
				});
			}
		}
		return [...groups.values()];
	})();
	const showAttachedPullRequests =
		!repeatEnabled && attachedPullRequestGroups.length > 0;

	const showGithubSection =
		showCommitPicker || showAttachedCommits || showAttachedPullRequests;

	const suggestedPullRequestsQ = useQuery({
		...suggestedPullRequestsQuery(orgSlug, projectId, targetDate),
		enabled: open && showCommitPicker && autoLoadCommits,
	});

	const effectiveSuggestedPullRequests = autoLoadCommits
		? (suggestedPullRequestsQ.data ?? [])
		: suggestedPullRequests;

	const attachedPullRequestUrls = new Set(
		(attachedPullRequests ?? []).map((a) => a.pullRequestUrl),
	);
	const pickablePullRequests = effectiveSuggestedPullRequests.filter(
		(pr) => !attachedPullRequestUrls.has(pr.url),
	);

	const togglePullRequestSelection = (key: string) => {
		const next = new Set(selectedPullRequestKeys);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		setSelectedPullRequestKeys(next);
		describeSelection(selectedCommitKeys, next);
	};

	const suggestPullRequestsMutation = useMutation({
		mutationFn: () =>
			suggestPullRequestsForEntry({ data: { projectId, date: targetDate } }),
		onSuccess: (pullRequests) => setSuggestedPullRequests(pullRequests),
		onError: (error) => {
			toast.error(error.message ?? "Could not fetch pull requests");
		},
	});

	// Removes every event row for one PR at once — the picker shows one line per
	// PR, so "remove" has to mean the whole PR, not whichever event happened to
	// be first in the group.
	const detachPullRequestMutation = useMutation({
		mutationFn: (activityIds: string[]) =>
			Promise.all(
				activityIds.map((id) => detachPullRequestFromEntry({ data: id })),
			),
		onSuccess: async () => {
			if (!entry) return;
			await queryClient.invalidateQueries({
				queryKey: attachedPullRequestsQuery(orgSlug, entry.id).queryKey,
			});
		},
		onError: (error) => {
			toast.error(error.message ?? "Could not remove pull request");
		},
	});

	// ── Google Calendar meeting picker ───────────────────────────────────────
	const [meetingUrl, setMeetingUrl] = useState<string | null>(null);
	const [calendarEventId, setCalendarEventId] = useState<string | null>(null);
	// The three switches live behind "More options", and the two pull-in lists
	// behind their footer links: a fresh dialog shows the entry and nothing else.
	const [moreOpen, setMoreOpen] = useState(false);
	const [calendarOpen, setCalendarOpen] = useState(false);
	const [activityOpen, setActivityOpen] = useState(false);
	useEffect(() => {
		if (!open) return;
		setMeetingUrl(null);
		setCalendarEventId(null);
		setMoreOpen(false);
		setCalendarOpen(false);
		setActivityOpen(false);
	}, [open]);
	// Only read on the client: the dialog body is never server-rendered, so the
	// label cannot mismatch, and a wrong guess is a cosmetic one.
	const [modKey] = useState(() =>
		/Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? "") ? "⌘" : "Ctrl",
	);

	// By systemKey, never by name: an org may rename the built-in Meeting task,
	// and a name match would then hide the calendar picker without a word.
	const isMeetingTask = selectedTask?.systemKey === "meeting";
	const showCalendarPicker =
		!repeatEnabled && !fillsDay && isMeetingTask && !!googleStatus?.connected;

	// Auto-load the day's meetings the moment the picker becomes relevant (the
	// Meeting task on a connected account) — no "Load meetings" click.
	const calendarEventsQ = useQuery({
		...calendarEventsForDayQuery(orgSlug, targetDate),
		enabled: open && showCalendarPicker,
	});
	const calendarEvents = calendarEventsQ.data ?? [];

	const pickCalendarEvent = (
		event: Awaited<ReturnType<typeof listCalendarEventsForDay>>[number],
	) => {
		// A picked meeting contributes its LENGTH, not its slot — a 25-minute
		// stand-up becomes 30 minutes of logged time, since entries snap to the
		// quarter hour.
		const seconds =
			(new Date(event.end).getTime() - new Date(event.start).getTime()) / 1000;
		// `snapToQuarterHour` is the whole rule in one call — nearest quarter hour,
		// floored at one. Flooring alone (what this used to do) put "25m" in the box
		// and then saved 30m, so the box disagreed with the entry it produced.
		form.setValue("duration", formatClock(snapToQuarterHour(seconds)), {
			shouldValidate: true,
		});
		if (!form.getValues("description")) {
			form.setValue("description", event.title);
		}
		setMeetingUrl(event.meetingUrl);
		setCalendarEventId(event.id);
	};

	// Checked on click only once Save has been pressed: before that, unticking
	// the last day would say "Pick a day" while the form is still being filled
	// in, and every other field waits for Save.
	const toggleDay = (day: number) => {
		const current = form.getValues("daysOfWeek");
		form.setValue(
			"daysOfWeek",
			current.includes(day)
				? current.filter((d) => d !== day)
				: [...current, day].sort(),
			{ shouldValidate: form.formState.isSubmitted },
		);
	};

	// "Tuesday, September 15, 2026" — the weekday because that is how a day is
	// remembered, the year because the stepper can leave this one.
	const dialogDateLabel = (key: string) => {
		const parts = key.split("-").map(Number);
		if (parts.length !== 3 || parts.some((p) => Number.isNaN(p))) return key;
		const [year, month, day] = parts;
		return new Date(
			Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1),
		).toLocaleDateString("en-US", {
			weekday: "long",
			month: "long",
			day: "numeric",
			year: "numeric",
			timeZone: "UTC",
		});
	};

	// Commits and pull request events happened on the entry's day, so an entry
	// holding them stays there. The service refuses the move as well; this only
	// keeps the stepper from offering it.
	const dayLocked =
		!!entry &&
		((attachedCommits?.length ?? 0) > 0 ||
			(attachedPullRequests?.length ?? 0) > 0);

	// The repeat days default to the day being logged, so they follow it until
	// repeat is switched on and the choice becomes the person's. What was picked
	// from the old day goes: its commits, pull requests and meeting belong to
	// that day, and saved on this one they would be evidence of the wrong day.
	const setDate = (next: string) => {
		if (next === form.getValues("date")) return;
		form.setValue("date", next, { shouldValidate: true });
		if (!form.getValues("repeatEnabled")) {
			form.setValue("daysOfWeek", [weekdayInTz(next, timezone)]);
		}
		setSuggestedCommits([]);
		setSelectedCommitKeys(new Set());
		setSuggestedPullRequests([]);
		setSelectedPullRequestKeys(new Set());
		setMeetingUrl(null);
		setCalendarEventId(null);
	};

	const mutation = useMutation<{ id: string }, Error, FormValues>({
		mutationFn: (values: FormValues) => {
			// Read from the submitted values rather than the render-time snapshot, so
			// what is validated is exactly what is sent.
			const parsed = parseDuration(values.duration);
			const seconds =
				parsed !== null && parsed > 0 ? snapToQuarterHour(parsed) : undefined;
			// Both sentinels are "no project" to the server; only the reason
			// differs, and the server does not need the reason.
			values = {
				...values,
				projectId:
					values.projectId === TIME_OFF || values.projectId === NO_PROJECT_YET
						? ""
						: values.projectId,
			};

			if (!entry && values.repeatEnabled) {
				return createRecurringBlockRule({
					data: {
						taskId: values.taskId,
						projectId: values.projectId || undefined,
						description: values.description || undefined,
						daysOfWeek: values.daysOfWeek,
						duration: values.duration,
						effectiveFrom: values.date,
						effectiveUntil: values.repeatEndDate || undefined,
					},
				});
			}
			const payload = {
				taskId: values.taskId,
				projectId: values.projectId || undefined,
				description: values.description || undefined,
				date: values.date,
				// A fill block's duration is derived server-side from the day's
				// remaining working hours, so none is sent.
				durationSeconds: values.fillsDay ? undefined : seconds,
				overtime: values.overtime,
				fillsDay: values.fillsDay,
				meetingUrl: values.fillsDay ? undefined : meetingUrl || undefined,
				calendarEventId: values.fillsDay
					? undefined
					: calendarEventId || undefined,
			};
			return entry
				? updateTimeEntry({ data: { ...payload, timeEntryId: entry.id } })
				: createTimeEntry({ data: payload });
		},
		onSuccess: async (savedEntry, values) => {
			if (!values.repeatEnabled && selectedCommitKeys.size > 0) {
				const commits = effectiveSuggested
					.filter((c) =>
						selectedCommitKeys.has(commitKey(c.projectGithubRepoId, c.sha)),
					)
					.map((c) => ({
						projectGithubRepoId: c.projectGithubRepoId,
						sha: c.sha,
					}));
				if (commits.length > 0) {
					await attachCommitsToEntry({
						data: { timeEntryId: savedEntry.id, commits },
					});
				}
			}
			if (!values.repeatEnabled && selectedPullRequestKeys.size > 0) {
				const pullRequests = effectiveSuggestedPullRequests
					.filter((pr) =>
						selectedPullRequestKeys.has(
							pullRequestKey(pr.projectGithubRepoId, pr.number),
						),
					)
					.map((pr) => ({
						projectGithubRepoId: pr.projectGithubRepoId,
						number: pr.number,
					}));
				if (pullRequests.length > 0) {
					await attachPullRequestsToEntry({
						data: { timeEntryId: savedEntry.id, pullRequests },
					});
				}
			}
			// The attached lists sit in the cache under the entry's id, fresh for
			// the default 30s, so reopening the entry showed the attachments from
			// before this save until a reload.
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: attachedCommitsQuery(orgSlug, savedEntry.id).queryKey,
				}),
				queryClient.invalidateQueries({
					queryKey: attachedPullRequestsQuery(orgSlug, savedEntry.id).queryKey,
				}),
			]);
			// Time off is never remembered: a day of leave is not what the next
			// entry is likely to be. An edit does not move the last pick either,
			// since correcting an old entry says nothing about the next one.
			if (values.projectId) {
				if (!entry) {
					rememberLastPick("entry", orgSlug, {
						projectId: values.projectId,
						taskId: values.taskId,
					});
				}
				if (!values.repeatEnabled) {
					rememberEntryOptions(orgSlug, values.projectId, values.taskId, {
						fillsDay: values.fillsDay,
						overtime: values.overtime,
					});
				}
			}
			await queryClient.invalidateQueries({
				queryKey: [...queryKeys(orgSlug).timeEntries],
			});
			// The task just logged is the next "Recent".
			await queryClient.invalidateQueries({
				queryKey: [...queryKeys(orgSlug).tasks, "recent"],
			});
			if (!entry) {
				await queryClient.invalidateQueries({
					queryKey: recurringBlockRulesQuery(orgSlug).queryKey,
				});
			}
			// Saved to a day other than the one the dialog opened on, which the page
			// behind it may not show: say where the time went.
			if (!values.repeatEnabled && values.date !== defaultDate) {
				toast.success(`Saved to ${formatDateKeyLong(values.date)}`);
			}
			setOpen(false);
		},
		onError: (error) => {
			toast.error(error.message ?? "Could not save time entry");
		},
	});

	const showRepeatSection = !entry && !fillsDay && !isAbsence;
	/** The fifth preset. An absence is a whole day off, not a block sized from
	 *  what the day has left, and a repeating entry has no single day to take a
	 *  remainder from — which is the condition the old switch was hidden by. */
	const showFillPreset = !isAbsence && !repeatEnabled;
	// What the collapsed disclosure says it is holding. "Fill rest of day" is no
	// longer one of them: it is a preset beside the lengths now, lit whether or
	// not this is open.
	const activeOptions = [
		repeatEnabled ? "Repeat" : null,
		form.watch("overtime") ? "Overtime" : null,
	].flatMap((o) => (o ? [o] : []));

	const { mutate } = mutation;
	const submit = useCallback(
		(values: FormValues) => {
			if (needsDescription && !values.fillsDay && !values.description.trim()) {
				form.setError("description", { message: "Required" });
				return;
			}
			mutate(values);
		},
		[needsDescription, form, mutate],
	);
	// ⌘↩ / Ctrl+↩ saves from anywhere in the dialog — the textarea, where a
	// plain Enter is a new line, and the pickers, whose popups are portaled
	// outside the form and so never see a form-level key handler.
	useEffect(() => {
		if (!open) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
			event.preventDefault();
			void form.handleSubmit(submit)();
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [open, form, submit]);

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger render={trigger} />
			<DialogContent className="sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>{entry ? "Edit entry" : "Log time"}</DialogTitle>
					{/* The timesheet's ‹ date › stepper, so the day can change without
					    closing the dialog: yesterday's work logged today, or an entry
					    moved to the day it belongs to. */}
					<div className="flex h-8 w-fit items-center rounded-lg border text-sm">
						<button
							type="button"
							className={cn(
								stepperClass,
								"disabled:pointer-events-none disabled:opacity-40",
							)}
							aria-label="Previous day"
							disabled={dayLocked}
							onClick={() => setDate(addDaysToKey(targetDate, -1))}
						>
							<ArrowLeftIcon weight="regular" className="size-4" />
						</button>
						<span className="flex items-center gap-1.5 border-x px-3 font-medium whitespace-nowrap">
							{!dayLocked && <DateJump value={targetDate} onPick={setDate} />}
							{dialogDateLabel(targetDate)}
						</span>
						<button
							type="button"
							className={cn(
								stepperClass,
								"disabled:pointer-events-none disabled:opacity-40",
							)}
							aria-label="Next day"
							disabled={dayLocked}
							onClick={() => setDate(addDaysToKey(targetDate, 1))}
						>
							<ArrowRightIcon weight="regular" className="size-4" />
						</button>
					</div>
					{dayLocked && (
						<p className="text-xs text-muted-foreground">
							Its GitHub activity keeps this entry on this day.
						</p>
					)}
				</DialogHeader>
				<Form {...form}>
					<form
						onSubmit={form.handleSubmit(submit)}
						// `grid-cols-[minmax(0,1fr)]` for the same reason dialog-body
						// carries it: an implicit grid column is `auto`-sized, so its
						// items get `min-width: auto` and one long unbroken commit subject
						// widens the column past the dialog, taking every sibling field
						// with it. Pinning the column is what lets the `truncate` on the
						// commit rows actually bite.
						className="grid grid-cols-[minmax(0,1fr)] gap-4"
					>
						{/* Project then task, side by side from `sm`: the project decides
						    the task list, so they read left to right as one choice made in
						    two steps. Stacked under a single "Project / Task" label they
						    read as one control that had been cut in half, and neither half
						    carried a name of its own.

						    The same two columns as the note and duration below, so Task is
						    exactly as wide as Duration and the two rows share one edge.
						    `minmax(0,1fr)`, not `1fr`: a column sized `1fr` is
						    `minmax(auto,1fr)`, so its item's min-content width is a floor
						    and one long project name pushes the column past the dialog and
						    over the task picker beside it. */}
						<div className="grid gap-1.5">
							<div className="grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_10.75rem]">
								<FormField
									control={form.control}
									name="projectId"
									render={({ field }) => (
										// `grid-rows-[auto_1fr]` plus `h-full` on the trigger:
										// the label row stays its own height and the picker
										// takes the rest, so the two triggers are as tall as
										// each other whatever is in them — a project with no
										// client, or a task whose group this build does not
										// know, no longer leaves one box shorter than the one
										// beside it. An error is drawn inside the box, so it
										// never adds a row under either of them.
										<FormItem className="grid-rows-[auto_1fr] gap-2">
											<FormLabel>Project</FormLabel>
											<FormControl>
												<ProjectPicker
													aria-label="Project"
													className="h-full"
													projects={projects}
													// An unfiled entry's "no project" row is "not yet",
													// and keeps it worked time; anywhere else it is
													// Time-off. Same row, different answer.
													noProject={
														unfiledEdit ? "No project yet" : "Time-off"
													}
													value={
														field.value === TIME_OFF ||
														field.value === NO_PROJECT_YET
															? null
															: field.value
													}
													onValueChange={(next) => {
														if (unfiledEdit) {
															field.onChange(next ?? NO_PROJECT_YET);
															return;
														}
														const wasTimeOff = field.value === TIME_OFF;
														field.onChange(next ?? TIME_OFF);
														// A day off is a whole day until told otherwise;
														// leaving Time-off takes the prefill back out.
														if (next === null) {
															form.setValue("duration", "8:00");
														} else if (
															wasTimeOff &&
															form.getValues("duration") === "8:00"
														) {
															form.setValue("duration", "");
														}
													}}
												/>
											</FormControl>
											<FormMessage />
										</FormItem>
									)}
								/>
								<FormField
									control={form.control}
									name="taskId"
									render={({ field }) => (
										<FormItem className="grid-rows-[auto_1fr] gap-2">
											<FormLabel>Task</FormLabel>
											<FormControl>
												<TaskPicker
													aria-label="Task"
													className="h-full"
													tasks={pickableTasks}
													recentIds={recentIds}
													grouped={!isTimeOff}
													value={field.value}
													onValueChange={field.onChange}
													placeholder={
														tasks.length === 0
															? "Loading tasks…"
															: "Pick a task"
													}
													message={<FormMessage aria-hidden />}
												/>
											</FormControl>
										</FormItem>
									)}
								/>
							</div>
						</div>
						{/* What you did, and how long: side by side, the time box big
						    enough to be the thing you read back. The duration stays to the
						    RIGHT of the note, where it has always been — this is the most
						    used form in the product and the hand knows where the box is.

						    Both fields are `grid-rows-[auto_1fr]`, like the pair above: the
						    label keeps its own height and the box takes the rest, so a note
						    dragged taller takes the Duration box with it and leaves both
						    labels where they were. Each error sits in its box's bottom
						    corner, so neither box grows when one appears. */}
						<div className="grid gap-3">
							<div className="grid grid-cols-[minmax(0,1fr)_10.75rem] gap-2.5 max-sm:grid-cols-[minmax(0,1fr)]">
								<FormField
									control={form.control}
									name="description"
									render={({ field }) => (
										<FormItem className="grid-rows-[auto_1fr] gap-2">
											<FormLabel>
												{needsDescription && !fillsDay
													? "What you did"
													: "Note"}
											</FormLabel>
											<div className="relative">
												<FormControl>
													<Textarea
														rows={3}
														className="min-h-22 resize-y"
														placeholder={
															needsDescription && !fillsDay
																? "What did you work on?"
																: "Optional…"
														}
														{...field}
													/>
												</FormControl>
												<FormMessage className="pointer-events-none absolute right-2.5 bottom-2" />
											</div>
										</FormItem>
									)}
								/>
								{fillsDay ? (
									// Labelled like the field it stands in for, so the row keeps
									// both its names. Main's dashed `--input` outline, not a
									// tinted one: the preset below is already lit, and a second
									// highlight here would say the same thing twice in two
									// different colors.
									<div className="grid grid-rows-[auto_1fr] gap-2">
										<span className="text-sm leading-none font-medium">
											Duration
										</span>
										<div className="flex min-h-22 items-center justify-center rounded-lg border border-dashed border-input px-3 text-center text-sm text-muted-foreground">
											Rest of day
										</div>
									</div>
								) : (
									<FormField
										control={form.control}
										name="duration"
										render={({ field }) => (
											<FormItem className="grid-rows-[auto_1fr] gap-2">
												<FormLabel>Duration</FormLabel>
												<div className="relative h-full">
													<FormControl>
														<Input
															{...field}
															placeholder="0:00"
															inputMode="decimal"
															className="mono h-full min-h-22 text-right text-[30px] font-medium tabular-nums"
															// Normalise on blur, the way the week grid's cells
															// already do — "1.5" becomes "1:30", so what is on
															// screen is what will be saved rather than a form the
															// reader has to snap in their own head.
															onBlur={(e) => {
																field.onBlur();
																const parsed = parseDuration(e.target.value);
																if (parsed !== null && parsed > 0) {
																	field.onChange(
																		formatClock(snapToQuarterHour(parsed)),
																	);
																}
															}}
														/>
													</FormControl>
													<FormMessage className="pointer-events-none absolute right-2.5 bottom-2" />
												</div>
											</FormItem>
										)}
									/>
								)}
							</div>
							{/* The lengths, across the width of the pair above. Four numbers
							    and "Rest of day", which is a different kind of answer and is
							    set apart as one by its words rather than by a treatment of
							    its own. A preset writes the field instead of opening
							    something, so the commonest case is one click and the box
							    still takes anything typed.

							    The lengths show whatever the project is. `isTimeOff` would
							    have been the obvious gate and is the wrong one: it means "no
							    project picked", which is the state every fresh dialog opens
							    in, so the row would be missing exactly when it is most
							    useful. Rest of day is the part that is conditional — an
							    absence has no fill block, and Repeat hid its switch for the
							    same reason. */}
							<div>
								<div
									className={cn(
										"grid gap-1.5",
										showFillPreset
											? "grid-cols-[repeat(4,1fr)_1.6fr]"
											: "grid-cols-4",
									)}
								>
									{QUICK_DURATIONS.map((value) => {
										const on = !fillsDay && durationValue === value;
										return (
											<button
												key={value}
												type="button"
												aria-pressed={on}
												onClick={() => {
													form.setValue("fillsDay", false, {
														shouldDirty: true,
													});
													form.setValue("duration", value, {
														shouldDirty: true,
														shouldValidate: true,
													});
												}}
												// The same `--input` hairline, hover and focus ring the
												// pickers and the boxes above wear. Unbordered they read
												// as chips dropped under a row of outlined controls —
												// the one row on the form drawn to a rule of its own.
												className={cn(
													"tnum rounded-lg border py-2 text-sm font-medium transition-[background-color,border-color,color] duration-(--dur-fast) outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/16",
													on
														? "border-primary/35 bg-primary/12 text-primary"
														: "border-input bg-transparent text-muted-foreground hover:border-muted-foreground/60 hover:text-foreground",
												)}
											>
												{value}
											</button>
										);
									})}
									{showFillPreset && (
										<button
											type="button"
											aria-pressed={fillsDay}
											disabled={dayHasFill && !fillsDay}
											title={
												dayHasFill && !fillsDay
													? "This day already has a rest-of-day block — edit or delete that one instead."
													: "Fills the rest of your working hours, minus everything else logged that day."
											}
											onClick={() =>
												form.setValue("fillsDay", !fillsDay, {
													shouldDirty: true,
												})
											}
											// Not highlighted at rest. It used to carry an accent
											// tint while switched OFF, which reads as selected —
											// the one thing a control must not do when it is not.
											className={cn(
												"rounded-lg border py-2 text-sm font-medium transition-[background-color,border-color,color] duration-(--dur-fast) outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/16 disabled:pointer-events-none disabled:opacity-40",
												fillsDay
													? "border-primary/35 bg-primary/12 font-semibold text-primary"
													: "border-input bg-transparent text-muted-foreground hover:border-muted-foreground/60 hover:text-foreground",
											)}
										>
											Rest of day
										</button>
									)}
								</div>

								{/* What Rest of day means, only while it is chosen. As permanent
							    small print it explained a control most readers had not
							    picked; the four numbers beside it need no gloss at all.

							    On a height spring, the same one the Repeat and More options
							    disclosures below ride: appearing and disappearing, this line
							    is the only thing on the form that changes the dialog's
							    height, and the popup is centred — so a snap moves every
							    field under the pointer by half the line. It sits INSIDE the
							    preset row's wrapper rather than beside it as another grid
							    child, because a collapsed grid row still contributes the
							    parent's gap: the caption would reach zero height and leave
							    12px of its own behind, which is the jump again, smaller. */}
								<AnimatePresence initial={false}>
									{fillsDay && (
										<motion.div
											key="fills-day-hint"
											initial={{ height: 0, opacity: 0 }}
											animate={{ height: "auto", opacity: 1 }}
											exit={{ height: 0, opacity: 0 }}
											transition={heightTransition}
											className="overflow-hidden"
										>
											<p className="pt-3 text-sm text-muted-foreground">
												Fills the rest of your working hours, minus everything
												else logged that day.
											</p>
										</motion.div>
									)}
								</AnimatePresence>
							</div>
						</div>
						{showCalendarPicker && calendarOpen && (
							<div className="rounded-lg border border-line2">
								<div className="flex items-center justify-between px-3 py-2">
									<span className="text-sm font-medium">Google Calendar</span>
									{calendarEventsQ.isFetching && (
										<span className="flex items-center gap-1.5 text-xs text-muted-foreground">
											<CalendarDotIcon className="pulse-quiet size-3.5" />
											Loading…
										</span>
									)}
								</div>
								{calendarEvents.length > 0 && (
									<div className="scrollbar-stable max-h-52 overflow-y-auto border-t border-line2">
										{calendarEvents.map((event) => {
											const selected = calendarEventId === event.id;
											return (
												<button
													key={event.id}
													type="button"
													onClick={() => {
														pickCalendarEvent(event);
														setCalendarOpen(false);
													}}
													className={cn(
														"flex w-full items-start gap-2 border-b border-line2 px-3 py-2 text-left last:border-b-0 hover:bg-muted",
														selected && "bg-muted",
													)}
												>
													<span className="min-w-0 flex-1">
														<span className="block truncate text-sm">
															{event.title}
														</span>
														<span className="text-xs text-muted-foreground">
															{timeKeyInTz(new Date(event.start), timezone)}–
															{timeKeyInTz(new Date(event.end), timezone)}
															{event.meetingUrl ? " · has link" : ""}
														</span>
													</span>
													{event.meetingUrl && (
														<VideoCameraIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
													)}
												</button>
											);
										})}
									</div>
								)}
								{calendarEventsQ.isError && (
									<p className="border-t border-line2 px-3 py-2 text-sm text-destructive">
										Could not load your calendar. Try reconnecting Google.
									</p>
								)}
								{calendarEventsQ.isSuccess && calendarEvents.length === 0 && (
									<p className="border-t border-line2 px-3 py-2 text-sm text-muted-foreground">
										No meetings found for this day.
									</p>
								)}
							</div>
						)}
						{meetingUrl && (
							<p className="-mt-2 truncate text-sm text-muted-foreground">
								Meeting link:{" "}
								<a
									href={meetingUrl}
									target="_blank"
									rel="noreferrer"
									className="underlined text-primary"
								>
									{meetingUrl}
								</a>
							</p>
						)}
						{showGithubSection &&
							(activityOpen ||
								showAttachedCommits ||
								showAttachedPullRequests) && (
								<div className="rounded-lg border border-line2">
									<div className="flex min-h-10 items-center justify-between px-3 py-1">
										<span className="text-sm font-medium">GitHub activity</span>
										{!showCommitPicker ? null : autoLoadCommits ? (
											<Button
												type="button"
												variant="ghost"
												size="sm"
												onClick={() => {
													suggestedCommitsQ.refetch();
													suggestedPullRequestsQ.refetch();
												}}
												disabled={
													suggestedCommitsQ.isFetching ||
													suggestedPullRequestsQ.isFetching
												}
											>
												<GitCommitIcon className="size-3.5" />
												{suggestedCommitsQ.isFetching ||
												suggestedPullRequestsQ.isFetching
													? "Loading…"
													: "Refresh"}
											</Button>
										) : (
											<Button
												type="button"
												variant="ghost"
												size="sm"
												onClick={() => {
													suggestCommitsMutation.mutate();
													suggestPullRequestsMutation.mutate();
												}}
												disabled={
													suggestCommitsMutation.isPending ||
													suggestPullRequestsMutation.isPending
												}
											>
												<GitCommitIcon className="size-3.5" />
												{suggestCommitsMutation.isPending ||
												suggestPullRequestsMutation.isPending
													? "Finding…"
													: "Find activity"}
											</Button>
										)}
									</div>

									{(showCommitPicker || showAttachedCommits) && (
										<div>
											<div className="border-t border-line2 px-3 py-1.5 text-2xs font-medium text-muted-foreground">
												Commits
											</div>

											{showAttachedCommits && (
												<div className="scrollbar-stable max-h-40 overflow-y-auto border-t border-line2">
													{(attachedCommits ?? []).map((commit) => (
														<div
															key={commit.id}
															className="flex items-center justify-between gap-2 border-b border-line2 px-3 py-2 last:border-b-0"
														>
															{/* The sha is the link, not the whole row: the row is
															    also a click target for nothing else, and making the
															    message a link would put an underline through a
															    subject that is often the entry's own description.
															    `url` has always been stored on the attachment; it
															    simply had nothing rendering it. */}
															<span className="flex min-w-0 items-baseline gap-1.5 text-sm">
																<a
																	href={commit.url}
																	target="_blank"
																	rel="noreferrer"
																	className="mono shrink-0 text-xs text-muted-foreground underline underline-offset-3 hover:text-foreground"
																	title={commit.repo?.fullName ?? undefined}
																>
																	{commit.sha.slice(0, 7)}
																</a>
																<span className="min-w-0 truncate">
																	{commit.message.split("\n")[0]}
																</span>
															</span>
															<Button
																type="button"
																variant="ghost"
																size="icon-xs"
																className="shrink-0 hover:text-destructive"
																onClick={() =>
																	detachCommitMutation.mutate(commit.id)
																}
																disabled={detachCommitMutation.isPending}
															>
																<XIcon weight="regular" className="size-3" />
																<span className="sr-only">Remove</span>
															</Button>
														</div>
													))}
												</div>
											)}

											{pickableCommits.length > 0 && (
												<div className="scrollbar-stable max-h-52 overflow-y-auto border-t border-line2">
													{pickableCommits.map((commit) => {
														const key = commitKey(
															commit.projectGithubRepoId,
															commit.sha,
														);
														const selected = selectedCommitKeys.has(key);
														return (
															<label
																key={key}
																className="flex cursor-pointer items-start gap-2 border-b border-line2 px-3 py-2 last:border-b-0"
															>
																<input
																	type="checkbox"
																	className="mt-0.5 accent-primary"
																	checked={selected}
																	onChange={() => toggleCommitSelection(key)}
																/>
																<span className="min-w-0 flex-1 text-sm">
																	<span className="block truncate">
																		{commit.message.split("\n")[0]}
																	</span>
																	<span className="block truncate text-xs text-muted-foreground">
																		{commit.repoFullName} ·{" "}
																		{commit.sha.slice(0, 7)}
																	</span>
																</span>
															</label>
														);
													})}
												</div>
											)}

											{(autoLoadCommits
												? suggestedCommitsQ.isSuccess
												: suggestCommitsMutation.isSuccess) &&
												pickableCommits.length === 0 && (
													<p className="border-t border-line2 px-3 py-2 text-sm text-muted-foreground">
														No commits found for this day.
													</p>
												)}
										</div>
									)}

									{(showCommitPicker || showAttachedPullRequests) && (
										<div>
											<div className="border-t border-line2 px-3 py-1.5 text-2xs font-medium text-muted-foreground">
												Pull requests
											</div>

											{showAttachedPullRequests && (
												<div className="scrollbar-stable max-h-40 overflow-y-auto border-t border-line2">
													{attachedPullRequestGroups.map((group) => (
														<div
															key={group.pullRequestUrl}
															className="flex items-center justify-between gap-2 border-b border-line2 px-3 py-2 last:border-b-0"
														>
															<span className="flex min-w-0 items-baseline gap-1.5 text-sm">
																<a
																	href={group.pullRequestUrl}
																	target="_blank"
																	rel="noreferrer"
																	className="mono shrink-0 text-xs text-muted-foreground underline underline-offset-3 hover:text-foreground"
																>
																	#{group.number}
																</a>
																<span className="min-w-0 truncate">
																	{group.title}
																</span>
															</span>
															<span className="flex shrink-0 items-center gap-2">
																<span className="hidden text-xs text-muted-foreground sm:inline">
																	{activitySummary(group.events)}
																</span>
																<Button
																	type="button"
																	variant="ghost"
																	size="icon-xs"
																	className="hover:text-destructive"
																	onClick={() =>
																		detachPullRequestMutation.mutate(group.ids)
																	}
																	disabled={detachPullRequestMutation.isPending}
																>
																	<XIcon weight="regular" className="size-3" />
																	<span className="sr-only">Remove</span>
																</Button>
															</span>
														</div>
													))}
												</div>
											)}

											{pickablePullRequests.length > 0 && (
												<div className="scrollbar-stable max-h-52 overflow-y-auto border-t border-line2">
													{pickablePullRequests.map((pr) => {
														const key = pullRequestKey(
															pr.projectGithubRepoId,
															pr.number,
														);
														const selected = selectedPullRequestKeys.has(key);
														return (
															<label
																key={key}
																className="flex cursor-pointer items-start gap-2 border-b border-line2 px-3 py-2 last:border-b-0"
															>
																<input
																	type="checkbox"
																	className="mt-0.5 accent-primary"
																	checked={selected}
																	onChange={() =>
																		togglePullRequestSelection(key)
																	}
																/>
																<span className="min-w-0 flex-1 text-sm">
																	<span className="block truncate">
																		{pr.title}
																	</span>
																	<span className="block truncate text-xs text-muted-foreground">
																		{pr.repoFullName} #{pr.number} ·{" "}
																		{activitySummary(pr.activity)}
																	</span>
																</span>
															</label>
														);
													})}
												</div>
											)}

											{(autoLoadCommits
												? suggestedPullRequestsQ.isSuccess
												: suggestPullRequestsMutation.isSuccess) &&
												pickablePullRequests.length === 0 && (
													<p className="border-t border-line2 px-3 py-2 text-sm text-muted-foreground">
														No pull requests found for this day.
													</p>
												)}
										</div>
									)}
								</div>
							)}
						{!isTimeOff && (
							<div className="border-t border-line2 pt-2">
								{/* A disclosure, not a bare conditional render, for the same
								    reason the Repeat block inside it is one: opening it must not
								    jump the footer out from under the pointer. */}
								<button
									type="button"
									onClick={() => setMoreOpen((current) => !current)}
									aria-expanded={moreOpen}
									className="flex items-center gap-1.5 rounded-md py-1 text-base text-muted-foreground transition-colors duration-(--dur-fast) outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/16"
								>
									<CaretRightIcon
										weight="regular"
										className={cn(
											"size-3.5 transition-transform duration-(--dur-base)",
											moreOpen && "rotate-90",
										)}
									/>
									More options
									{activeOptions.length > 0 && (
										<span className="ml-1 flex flex-wrap gap-1">
											{activeOptions.map((option) => (
												<Badge key={option} variant="secondary">
													{option}
												</Badge>
											))}
										</span>
									)}
								</button>
								<AnimatePresence initial={false}>
									{moreOpen && (
										<motion.div
											key="more-options"
											initial={{ height: 0, opacity: 0 }}
											animate={{ height: "auto", opacity: 1 }}
											exit={{ height: 0, opacity: 0 }}
											transition={heightTransition}
											className="overflow-hidden"
										>
											<div className="grid divide-y divide-line2 pt-1">
												{/* Overtime and Repeat, and nothing else. "Fill rest
												    of day" left this disclosure to become the fifth
												    preset under the duration field, which is where
												    somebody looking for it actually looks — behind a
												    fold, the one control that sizes a block from the
												    day's remainder was a feature nobody found. */}
												{showRepeatSection && (
													<div className="py-3">
														<div className="flex items-center justify-between gap-3">
															<div className="min-w-0">
																<span className="text-base font-medium">
																	Repeat
																</span>
																<p className="text-sm text-muted-foreground">
																	Log this every week on the days you pick.
																</p>
															</div>
															<Switch
																checked={repeatEnabled}
																onCheckedChange={(checked) =>
																	form.setValue("repeatEnabled", checked)
																}
															/>
														</div>
														<AnimatePresence initial={false}>
															{repeatEnabled && (
																<motion.div
																	key="repeat-options"
																	initial={{ height: 0, opacity: 0 }}
																	animate={{ height: "auto", opacity: 1 }}
																	exit={{ height: 0, opacity: 0 }}
																	transition={heightTransition}
																	className="overflow-hidden"
																>
																	<div className="mt-3 flex flex-col gap-3">
																		{/* The days have no box to hold an error, so it
																		    sits at the end of their row — as it does at
																		    the end of an input's line — and the row never
																		    grows. */}
																		<div className="flex items-center gap-1">
																			{weekdays.map(({ day, initial }) => (
																				<button
																					key={day}
																					type="button"
																					onClick={() => toggleDay(day)}
																					className={cn(
																						"mono size-7 rounded-full border text-xs transition-colors duration-(--dur-fast)",
																						daysOfWeek.includes(day)
																							? "border-primary bg-primary text-primary-foreground"
																							: "border-border bg-background text-muted-foreground",
																					)}
																				>
																					{initial}
																				</button>
																			))}
																			{form.formState.errors.daysOfWeek && (
																				<span className="ms-auto text-xs text-destructive">
																					{
																						form.formState.errors.daysOfWeek
																							.message
																					}
																				</span>
																			)}
																		</div>
																		<FormField
																			control={form.control}
																			name="repeatEndDate"
																			render={({ field }) => (
																				<FormItem>
																					<FormLabel className="text-xs">
																						Ends (optional)
																					</FormLabel>
																					<FormControl>
																						{/* Genuinely optional — a repeat with no
																						    end date runs until it is removed. */}
																						<DatePicker
																							aria-label="Repeat ends"
																							placeholder="No end date"
																							clearable
																							value={field.value || null}
																							onValueChange={(next) =>
																								field.onChange(next ?? "")
																							}
																						/>
																					</FormControl>
																				</FormItem>
																			)}
																		/>
																	</div>
																</motion.div>
															)}
														</AnimatePresence>
													</div>
												)}
												<div className="flex items-center justify-between gap-3 py-3">
													<div className="min-w-0">
														<span className="text-base font-medium">
															Overtime
														</span>
														<p className="text-sm text-muted-foreground">
															Flag it yourself — nothing is counted as overtime
															automatically.
														</p>
													</div>
													<FormField
														control={form.control}
														name="overtime"
														render={({ field }) => (
															<Switch
																checked={field.value}
																onCheckedChange={field.onChange}
															/>
														)}
													/>
												</div>
											</div>
										</motion.div>
									)}
								</AnimatePresence>
							</div>
						)}
						{/* Wraps as a whole: when the row is too narrow the links take a
						    line of their own, instead of the group squeezing and putting
						    each link on its own line. */}
						<DialogFooter className="sm:flex-wrap">
							{(showCalendarPicker || showCommitPicker) && (
								<div className="flex flex-wrap items-center gap-x-4 gap-y-1 sm:mr-auto sm:flex-nowrap">
									{showCalendarPicker && (
										<Button
											type="button"
											variant="link"
											size="sm"
											className="px-0"
											onClick={() => setCalendarOpen((current) => !current)}
										>
											<CalendarDotIcon className="size-4" />
											Pull in a calendar event
										</Button>
									)}
									{showCommitPicker && (
										<Button
											type="button"
											variant="link"
											size="sm"
											className="px-0"
											onClick={() => {
												setActivityOpen((current) => !current);
												if (!autoLoadCommits) {
													if (!suggestCommitsMutation.isSuccess) {
														suggestCommitsMutation.mutate();
													}
													if (!suggestPullRequestsMutation.isSuccess) {
														suggestPullRequestsMutation.mutate();
													}
												}
											}}
										>
											<GitPullRequestIcon className="size-4" />
											Pull in GitHub activity
										</Button>
									)}
								</div>
							)}
							<DialogClose render={<Button type="button" variant="ghost" />}>
								Cancel
							</DialogClose>
							<Button type="submit" disabled={mutation.isPending}>
								{entry
									? "Save entry"
									: repeatEnabled
										? "Create repeating entry"
										: "Save entry"}
								<kbd className="mono rounded-sm bg-primary-foreground/22 px-1 text-2xs">
									{modKey}↩
								</kbd>
							</Button>
						</DialogFooter>
					</form>
				</Form>
			</DialogContent>
		</Dialog>
	);
}
