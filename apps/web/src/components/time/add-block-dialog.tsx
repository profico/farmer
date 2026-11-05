import {
	addDaysToKey,
	snapToQuarterHour,
	weekdayInTz,
} from "@farmer/core/lib/time";
import { zodResolver } from "@hookform/resolvers/zod";
import {
	useMutation,
	useQuery,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "#/components/ui/dialog.tsx";
import { Form } from "#/components/ui/form.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { useWeekdays } from "#/hooks/use-week-starts-on.ts";
import { formatClock } from "#/lib/format-hours.ts";
import { useHeightTransition } from "#/lib/motion.ts";
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
import { myProjectsQuery } from "#/queries/projects.ts";
import { recentTasksQuery, tasksForProjectQuery } from "#/queries/tasks.ts";
import { timeEntriesRangeQuery } from "#/queries/time-entries.ts";
import {
	detachCommitFromEntry,
	detachPullRequestFromEntry,
	suggestCommitsForEntry,
	suggestPullRequestsForEntry,
} from "#/server/github.ts";
import type { listMyProjects } from "#/server/projects.ts";

import {
	CalendarEventList,
	GithubActivityPanel,
	MeetingLink,
} from "./add-block-activity.tsx";
import {
	DateStepper,
	DurationPresets,
	FooterActions,
	MoreOptions,
	NoteAndDuration,
	ProjectTaskFields,
} from "./add-block-fields.tsx";
import {
	activeOptionLabels,
	activityLoadState,
	buildDefaults,
	type CalendarEvent,
	chooseSuggestions,
	dayHasFillBlock,
	describeSelection,
	dialogVisibility,
	type ExistingTimeEntry,
	type FormValues,
	formSchema,
	githubPanelShown,
	groupAttachedPullRequests,
	isProjectPick,
	isStaleTask,
	isUnfiledEdit,
	needsDescriptionFor,
	rememberedOptions,
	rememberedPick,
	saveLabel,
	TIME_OFF,
	toggledSet,
	unattachedCommits,
	unattachedPullRequests,
} from "./add-block-form.ts";
import { finishSave, submitEntry } from "./add-block-save.ts";

export type { ExistingTimeEntry };

// The attached lists are read for an entry that already exists, and only
// while the dialog is open.
const attachedCommitsFor = (
	orgSlug: string,
	open: boolean,
	entry: ExistingTimeEntry | undefined,
) => ({
	...attachedCommitsQuery(orgSlug, entry?.id ?? ""),
	enabled: open && !!entry,
});

const attachedPullRequestsFor = (
	orgSlug: string,
	open: boolean,
	entry: ExistingTimeEntry | undefined,
) => ({
	...attachedPullRequestsQuery(orgSlug, entry?.id ?? ""),
	enabled: open && !!entry,
});

// A mutation that fails says why, or else says what it was doing.
const failWith = (fallback: string) => (error: Error) => {
	toast.error(error.message ?? fallback);
};

type AddBlockDialogProps = {
	timezone: string;
	/** The day the dialog opens on; the stepper in its header moves from there.
	 *  An existing entry opens on its own day. */
	defaultDate: string;
	/** Opened from a project's own page: that project, already chosen. */
	defaultProjectId?: string;
	entry?: ExistingTimeEntry;
	trigger: React.ReactElement;
};

/**
 * The trigger and the open state, and nothing else until the first open.
 *
 * The body is a form, a dozen queries and every effect below, and the Day
 * view draws one of these per entry row for its Edit button — all of it
 * rendered and hydrated for dialogs that are mostly never opened. That is
 * page load a press on "Log time" waits behind, and a press that lands before
 * hydration is lost outright. So the body mounts on the first open and then
 * STAYS: closing keeps its state exactly as it was before this split, and the
 * exit animation has something to animate.
 *
 * The projects are read here and not in the body: this observer is what keeps
 * them in the cache, so a first open late in a long session answers from it
 * instead of suspending the whole page.
 */
export function AddBlockDialog({ trigger, ...props }: AddBlockDialogProps) {
	const orgSlug = useOrgSlug();
	const [open, setOpen] = useState(false);
	const [opened, setOpened] = useState(false);
	if (open && !opened) setOpened(true);
	const { data: projects } = useSuspenseQuery(myProjectsQuery(orgSlug));
	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger render={trigger} />
			{opened && (
				<AddBlockDialogBody
					{...props}
					open={open}
					setOpen={setOpen}
					projects={projects}
				/>
			)}
		</Dialog>
	);
}

function AddBlockDialogBody({
	timezone,
	defaultDate: defaultDateProp,
	defaultProjectId,
	entry,
	open,
	setOpen,
	projects,
}: Omit<AddBlockDialogProps, "trigger"> & {
	open: boolean;
	setOpen: (open: boolean) => void;
	projects: Awaited<ReturnType<typeof listMyProjects>>;
}) {
	const orgSlug = useOrgSlug();
	// The three disclosures below all open by changing their HEIGHT, which the
	// root <MotionConfig reducedMotion="user"> does not touch — see the hook.
	const heightTransition = useHeightTransition();
	const queryClient = useQueryClient();

	const defaultDate = entry?.date ?? defaultDateProp;
	const isEdit = !!entry;
	const unfiledEdit = isUnfiledEdit(entry);

	const form = useForm<FormValues>({
		resolver: zodResolver(formSchema),
		defaultValues: buildDefaults(
			entry,
			defaultDate,
			defaultProjectId,
			timezone,
		),
	});

	/* oxlint-disable react-hooks/exhaustive-deps -- only reset when the dialog opens */
	useEffect(() => {
		if (!open) return;
		form.reset({
			...buildDefaults(entry, defaultDate, defaultProjectId, timezone),
			...rememberedPick(entry, orgSlug, defaultProjectId, projects),
		});
	}, [open]);
	/* oxlint-enable react-hooks/exhaustive-deps */

	const projectId = form.watch("projectId");
	const taskId = form.watch("taskId");
	const targetDate = form.watch("date") || defaultDate;
	const repeatEnabled = form.watch("repeatEnabled");
	const fillsDay = form.watch("fillsDay");
	const daysOfWeek = form.watch("daysOfWeek");
	const weekdays = useWeekdays();

	const isTimeOff = projectId === TIME_OFF;
	const hasProject = isProjectPick(projectId);
	// The task list follows the project: with one it is the whole grouped list,
	// without one the short project-less list (time off and the built-ins). Every
	// project offers the same list, so the task survives a switch between them;
	// crossing into or out of Time-off is what can leave one that no longer
	// applies, and the effect below lets that one go.
	const { data: tasks = [] } = useQuery({
		...tasksForProjectQuery(orgSlug, hasProject ? projectId : undefined),
		enabled: open,
	});
	const { data: recentIds = [] } = useQuery({
		...recentTasksQuery(orgSlug, projectId),
		enabled: open && hasProject,
	});
	// Under Time-off only the leave kinds are offered; Break and Meeting are
	// logged on a project like everything else.
	const pickableTasks = isTimeOff ? tasks.filter((t) => t.isAbsence) : tasks;
	const selectedTask = tasks.find((t) => t.id === taskId);
	// By systemKey, never by name: an org may rename the built-in Meeting task.
	const meetingTaskId = pickableTasks.find(
		(t) => t.systemKey === "meeting",
	)?.id;
	useEffect(() => {
		if (isStaleTask(taskId, pickableTasks)) form.setValue("taskId", "");
	}, [pickableTasks, taskId, form]);

	// Worked time must say what was done; time off and a Break need not. The
	// task decides, and the rule is asked at submit against the task chosen
	// then — not stored on the form, where a value set by an effect went stale
	// across a reopen and demanded a note the label had just called optional.
	const needsDescription = needsDescriptionFor(selectedTask);

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
	const dayHasFill = dayHasFillBlock(entry, dayEntries);
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
		const remembered = rememberedOptions(orgSlug, projectId, taskId, isTimeOff);
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
	const { data: attachedCommits } = useQuery(
		attachedCommitsFor(orgSlug, open, entry),
	);
	const { data: attachedPullRequests } = useQuery(
		attachedPullRequestsFor(orgSlug, open, entry),
	);
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

	const attachedPullRequestGroups =
		groupAttachedPullRequests(attachedPullRequests);
	const visibility = dialogVisibility({
		isEdit,
		repeatEnabled,
		fillsDay,
		isAbsence,
		hasProject,
		meetingTaskId,
		github: githubStatus,
		google: googleStatus,
		linkedRepos,
		attachedCommits,
		attachedPullRequests,
	});

	const {
		showCommitPicker,
		showAttachedCommits,
		showAttachedPullRequests,
		showCalendarPicker,
		showRepeatSection,
		showFillPreset,
		dayLocked,
	} = visibility;

	// With auto-load on, the day's commits populate the picker as soon as it's
	// relevant — no "Find commits" click. When off, the manual mutation below is
	// the only source and this query stays disabled.
	const autoLoadActive = open && showCommitPicker && autoLoadCommits;
	const suggestedCommitsQ = useQuery({
		...suggestedCommitsQuery(orgSlug, projectId, targetDate),
		enabled: autoLoadActive,
	});

	// One list feeds the picker regardless of how it was populated: the auto-load
	// query when the toggle is on, the manual mutation's result otherwise.
	const effectiveSuggested = chooseSuggestions(
		autoLoadCommits,
		suggestedCommitsQ.data,
		suggestedCommits,
	);
	const pickableCommits = unattachedCommits(
		effectiveSuggested,
		attachedCommits,
	);

	// Ticking activity writes the description from it, the way the commit engine
	// writes its own blocks' — but only into a box that is empty or still holds
	// what the last tick wrote. The ref is that last write: once the person types
	// over it, the text is theirs and further ticks leave it alone.
	const autoDescriptionRef = useRef<string | null>(null);
	useEffect(() => {
		if (open) autoDescriptionRef.current = null;
	}, [open]);
	const writeSelectionNote = (
		commitKeys: Set<string>,
		pullRequestKeys: Set<string>,
	) => {
		const current = form.getValues("description");
		if (current.trim() && current !== autoDescriptionRef.current) return;
		const next = describeSelection(
			effectiveSuggested,
			effectiveSuggestedPullRequests,
			commitKeys,
			pullRequestKeys,
		);
		autoDescriptionRef.current = next;
		if (next === current) return;
		form.setValue("description", next);
		if (next) form.clearErrors("description");
	};

	const toggleCommitSelection = (key: string) => {
		const next = toggledSet(selectedCommitKeys, key);
		setSelectedCommitKeys(next);
		writeSelectionNote(next, selectedPullRequestKeys);
	};

	const suggestCommitsMutation = useMutation({
		mutationFn: () =>
			suggestCommitsForEntry({ data: { projectId, date: targetDate } }),
		onSuccess: (commits) => setSuggestedCommits(commits),
		onError: failWith("Could not fetch commits"),
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
		onError: failWith("Could not remove commit"),
	});

	const suggestedPullRequestsQ = useQuery({
		...suggestedPullRequestsQuery(orgSlug, projectId, targetDate),
		enabled: autoLoadActive,
	});

	const effectiveSuggestedPullRequests = chooseSuggestions(
		autoLoadCommits,
		suggestedPullRequestsQ.data,
		suggestedPullRequests,
	);
	const pickablePullRequests = unattachedPullRequests(
		effectiveSuggestedPullRequests,
		attachedPullRequests,
	);

	const togglePullRequestSelection = (key: string) => {
		const next = toggledSet(selectedPullRequestKeys, key);
		setSelectedPullRequestKeys(next);
		writeSelectionNote(selectedCommitKeys, next);
	};

	const suggestPullRequestsMutation = useMutation({
		mutationFn: () =>
			suggestPullRequestsForEntry({ data: { projectId, date: targetDate } }),
		onSuccess: (pullRequests) => setSuggestedPullRequests(pullRequests),
		onError: failWith("Could not fetch pull requests"),
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
		onError: failWith("Could not remove pull request"),
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

	// Auto-load the day's meetings the moment the picker becomes relevant (the
	// Meeting task on offer and a connected account) — no "Load meetings" click.
	const calendarEventsQ = useQuery({
		...calendarEventsForDayQuery(orgSlug, targetDate),
		enabled: open && showCalendarPicker,
	});
	const calendarEvents = calendarEventsQ.data ?? [];

	const pickCalendarEvent = (event: CalendarEvent) => {
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
		// A pulled-in event is a meeting, so the entry becomes one.
		if (meetingTaskId) form.setValue("taskId", meetingTaskId);
		setMeetingUrl(event.meetingUrl);
		setCalendarEventId(event.id);
		setCalendarOpen(false);
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
		mutationFn: (values: FormValues) =>
			submitEntry(values, entry, { meetingUrl, calendarEventId }),
		onSuccess: (savedEntry, values) =>
			finishSave(
				{
					savedEntry,
					values,
					entry,
					orgSlug,
					queryClient,
					defaultDate,
					suggestedCommits: effectiveSuggested,
					suggestedPullRequests: effectiveSuggestedPullRequests,
					selectedCommitKeys,
					selectedPullRequestKeys,
				},
				() => setOpen(false),
			),
		onError: failWith("Could not save time entry"),
	});

	const activeOptions = activeOptionLabels(
		repeatEnabled,
		form.watch("overtime"),
	);

	const { mutate } = mutation;
	// The disabled Save button only guards a click. ⌘↩ reaches `submit` from a
	// document listener, and a second press mid-save logged the entry twice. A
	// ref and not `isPending`: two presses can land before the render that
	// would disable anything.
	const saving = useRef(false);
	const submit = useCallback(
		(values: FormValues) => {
			if (saving.current) return;
			if (needsDescription && !values.fillsDay && !values.description.trim()) {
				form.setError("description", { message: "Required" });
				return;
			}
			saving.current = true;
			mutate(values, {
				onSettled: () => {
					saving.current = false;
				},
			});
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

	const activity = activityLoadState(
		autoLoadCommits,
		{ commits: suggestedCommitsQ, pullRequests: suggestedPullRequestsQ },
		{
			commits: suggestCommitsMutation,
			pullRequests: suggestPullRequestsMutation,
		},
	);
	const reloadActivity = () => {
		if (autoLoadCommits) {
			suggestedCommitsQ.refetch();
			suggestedPullRequestsQ.refetch();
		} else {
			suggestCommitsMutation.mutate();
			suggestPullRequestsMutation.mutate();
		}
	};
	const toggleActivity = () => {
		setActivityOpen((current) => !current);
		if (autoLoadCommits) return;
		if (!suggestCommitsMutation.isSuccess) suggestCommitsMutation.mutate();
		if (!suggestPullRequestsMutation.isSuccess) {
			suggestPullRequestsMutation.mutate();
		}
	};

	return (
		<DialogContent className="sm:max-w-xl">
			<DialogHeader>
				<DialogTitle>{isEdit ? "Edit entry" : "Log time"}</DialogTitle>
				<DateStepper
					targetDate={targetDate}
					dayLocked={dayLocked}
					onSetDate={setDate}
					onStep={(days) => setDate(addDaysToKey(targetDate, days))}
				/>
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
					<ProjectTaskFields
						form={form}
						projects={projects}
						unfiledEdit={unfiledEdit}
						isTimeOff={isTimeOff}
						tasks={tasks}
						pickableTasks={pickableTasks}
						recentIds={recentIds}
					/>
					<div className="grid gap-3">
						<NoteAndDuration
							form={form}
							askForNote={needsDescription && !fillsDay}
							fillsDay={fillsDay}
						/>
						<DurationPresets
							form={form}
							fillsDay={fillsDay}
							durationValue={durationValue}
							showFillPreset={showFillPreset}
							dayHasFill={dayHasFill}
							heightTransition={heightTransition}
						/>
					</div>
					{showCalendarPicker && calendarOpen && (
						<CalendarEventList
							events={calendarEvents}
							isFetching={calendarEventsQ.isFetching}
							isError={calendarEventsQ.isError}
							isSuccess={calendarEventsQ.isSuccess}
							selectedEventId={calendarEventId}
							timezone={timezone}
							onPick={pickCalendarEvent}
						/>
					)}
					{meetingUrl && <MeetingLink url={meetingUrl} />}
					{githubPanelShown(visibility, activityOpen) && (
						<GithubActivityPanel
							showCommitPicker={showCommitPicker}
							autoLoadCommits={autoLoadCommits}
							busy={activity.busy}
							onReload={reloadActivity}
							commits={{
								show: showCommitPicker,
								showAttached: showAttachedCommits,
								attached: attachedCommits,
								pickable: pickableCommits,
								selectedKeys: selectedCommitKeys,
								loaded: activity.commitsLoaded,
								detaching: detachCommitMutation.isPending,
								onToggle: toggleCommitSelection,
								onDetach: detachCommitMutation.mutate,
							}}
							pullRequests={{
								show: showCommitPicker,
								showAttached: showAttachedPullRequests,
								groups: attachedPullRequestGroups,
								pickable: pickablePullRequests,
								selectedKeys: selectedPullRequestKeys,
								loaded: activity.pullRequestsLoaded,
								detaching: detachPullRequestMutation.isPending,
								onToggle: togglePullRequestSelection,
								onDetach: detachPullRequestMutation.mutate,
							}}
						/>
					)}
					{!isTimeOff && (
						<MoreOptions
							form={form}
							moreOpen={moreOpen}
							onToggleMore={() => setMoreOpen((current) => !current)}
							activeOptions={activeOptions}
							showRepeatSection={showRepeatSection}
							repeatEnabled={repeatEnabled}
							daysOfWeek={daysOfWeek}
							daysError={form.formState.errors.daysOfWeek?.message}
							weekdays={weekdays}
							onToggleDay={toggleDay}
							heightTransition={heightTransition}
						/>
					)}
					<FooterActions
						showCalendarPicker={showCalendarPicker}
						showCommitPicker={showCommitPicker}
						onToggleCalendar={() => setCalendarOpen((current) => !current)}
						onToggleActivity={toggleActivity}
						saveText={saveLabel({
							pending: mutation.isPending,
							isEdit,
							repeatEnabled,
						})}
						saving={mutation.isPending}
						modKey={modKey}
					/>
				</form>
			</Form>
		</DialogContent>
	);
}
