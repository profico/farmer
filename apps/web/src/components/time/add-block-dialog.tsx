import {
	formatDurationInput,
	parseDuration,
	snapToQuarterHour,
	timeKeyInTz,
	weekdayInTz,
} from "@farmer/core/lib/time";
import {
	CalendarDotIcon,
	GitCommitIcon,
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
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "#/components/ui/button.tsx";
import {
	Dialog,
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
import { DatePicker } from "#/components/ui/date-picker.tsx";
import { Input } from "#/components/ui/input.tsx";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select.tsx";
import { Switch } from "#/components/ui/switch.tsx";
import { Textarea } from "#/components/ui/textarea.tsx";
import { springProductive } from "#/lib/motion.ts";
import { cn } from "#/lib/utils.ts";
import {
	attachedCommitsQuery,
	githubConnectionStatusQuery,
	projectGithubReposQuery,
	suggestedCommitsQuery,
} from "#/queries/github.ts";
import {
	calendarEventsForDayQuery,
	googleCalendarStatusQuery,
} from "#/queries/google-calendar.ts";
import { integrationSettingsQuery } from "#/queries/integration-settings.ts";
import { queryKeys } from "#/queries/keys.ts";
import { myProjectsQuery } from "#/queries/projects.ts";
import { recurringBlockRulesQuery } from "#/queries/recurring-block-rules.ts";
import { tasksForProjectQuery } from "#/queries/tasks.ts";
import { timeEntriesRangeQuery } from "#/queries/time-entries.ts";
import {
	attachCommitsToEntry,
	detachCommitFromEntry,
	suggestCommitsForEntry,
} from "#/server/github.ts";
import type { listCalendarEventsForDay } from "#/server/google-calendar.ts";
import { createRecurringBlockRule } from "#/server/recurring-block-rules.ts";
import { createTimeEntry, updateTimeEntry } from "#/server/time-entries.ts";

const NO_PROJECT = "__none__";
const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"]; // index 0=Sun..6=Sat

export type ExistingTimeEntry = {
	id: string;
	date: string;
	projectId: string | null;
	taskId: string;
	description: string;
	durationSeconds: number;
	overtime: boolean;
	fillsDay: boolean;
	generatedFromRuleId: string | null;
};

type FormValues = {
	projectId: string;
	taskId: string;
	date: string;
	/** Free text, exactly as typed — `parseDuration` reads it. In the form rather
	 *  than in its own useState so it validates and reports errors inline like
	 *  every other field, instead of bouncing off the server as a toast. */
	duration: string;
	description: string;
	overtime: boolean;
	fillsDay: boolean;
	repeatEnabled: boolean;
	daysOfWeek: number[];
	repeatEndDate: string;
};

const MAX_ENTRY_SECONDS = 24 * 3600;

/** The client half of the server's duration rule (schema/time-entries.ts). Same
 *  three checks, so an empty or unreadable box is answered next to the box. */
const validateDuration = (value: string): string | true => {
	if (!value.trim()) return "Enter some time";
	const parsed = parseDuration(value);
	if (parsed === null) return "Try 1.5, 1h30m or 1:30";
	if (parsed <= 0) return "Enter some time";
	if (snapToQuarterHour(parsed) > MAX_ENTRY_SECONDS) {
		return "A single entry cannot exceed 24 hours";
	}
	return true;
};

function commitKey(projectGithubRepoId: string, sha: string): string {
	return `${projectGithubRepoId}:${sha}`;
}

export function AddBlockDialog({
	timezone,
	dateOptions,
	defaultDate: defaultDateProp,
	entry,
	trigger,
}: {
	timezone: string;
	dateOptions: { value: string; label: string }[];
	defaultDate?: string;
	entry?: ExistingTimeEntry;
	trigger: React.ReactElement;
}) {
	const [open, setOpen] = useState(false);
	const queryClient = useQueryClient();
	const { data: projects } = useSuspenseQuery(myProjectsQuery());

	const defaultDate =
		entry?.date ?? defaultDateProp ?? dateOptions[0]?.value ?? "";

	const buildDefaults = (): FormValues => ({
		projectId: entry?.projectId ?? NO_PROJECT,
		taskId: entry?.taskId ?? "",
		date: defaultDate,
		duration: entry ? formatDurationInput(entry.durationSeconds) : "",
		description: entry?.description ?? "",
		overtime: entry?.overtime ?? false,
		fillsDay: entry?.fillsDay ?? false,
		repeatEnabled: false,
		daysOfWeek: [weekdayInTz(defaultDate, timezone)],
		repeatEndDate: "",
	});

	const form = useForm<FormValues>({ defaultValues: buildDefaults() });

	// biome-ignore lint/correctness/useExhaustiveDependencies: only reset when the dialog opens
	useEffect(() => {
		if (!open) return;
		form.reset(buildDefaults());
	}, [open]);

	const projectId = form.watch("projectId");
	const taskId = form.watch("taskId");
	const targetDate = form.watch("date") || defaultDate;
	const repeatEnabled = form.watch("repeatEnabled");
	const fillsDay = form.watch("fillsDay");
	const daysOfWeek = form.watch("daysOfWeek");

	// The task list is the project's cherry-picked subset plus the two absence
	// tasks — so it can't be resolved until a project is chosen, and switching
	// project may invalidate the current pick.
	const { data: tasks = [] } = useQuery({
		...tasksForProjectQuery(projectId === NO_PROJECT ? undefined : projectId),
		enabled: open,
	});
	const selectedTask = tasks.find((t) => t.id === taskId);
	useEffect(() => {
		if (!taskId) return;
		if (tasks.length > 0 && !tasks.some((t) => t.id === taskId)) {
			form.setValue("taskId", "");
		}
	}, [tasks, taskId, form]);

	// An absence task (Vacation / Sick Leave) is logged against no project and
	// needs no note; picking one clears any project already chosen.
	const isAbsence = !!selectedTask?.isAbsence;
	useEffect(() => {
		if (isAbsence && form.getValues("projectId") !== NO_PROJECT) {
			form.setValue("projectId", NO_PROJECT);
		}
	}, [isAbsence, form]);

	// Duration is typed, not derived: there is no clock in this system, so an
	// entry is a date plus an amount of time, in 15-minute steps.
	const durationText = form.watch("duration");
	const parsedSeconds = parseDuration(durationText);
	// `snapToQuarterHour` rather than a local `Math.round(x / 900) * 900`: the
	// shared one floors at 15 minutes, so "0.1" becomes a real 15-minute block
	// instead of a 0 the server then rejects with a toast.
	const snappedSeconds =
		parsedSeconds !== null && parsedSeconds > 0
			? snapToQuarterHour(parsedSeconds)
			: null;
	// Show the rounding before the user commits to it, rather than silently
	// changing what they typed on save.
	const willSnap =
		snappedSeconds != null &&
		parsedSeconds != null &&
		snappedSeconds !== parsedSeconds;

	const { data: dayEntries } = useQuery({
		...timeEntriesRangeQuery(targetDate, targetDate),
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

	const { data: githubStatus } = useQuery({
		...githubConnectionStatusQuery(),
		enabled: open,
	});
	const { data: googleStatus } = useQuery({
		...googleCalendarStatusQuery(),
		enabled: open,
	});
	const { data: linkedRepos } = useQuery({
		...projectGithubReposQuery(projectId),
		enabled: open && projectId !== NO_PROJECT,
	});
	const { data: attachedCommits } = useQuery({
		...attachedCommitsQuery(entry?.id ?? ""),
		enabled: open && !!entry,
	});
	const { data: integrationSettings } = useQuery({
		...integrationSettingsQuery(),
		enabled: open,
	});
	const autoLoadCommits = !!integrationSettings?.githubAutoLoadCommits;

	const [suggestedCommits, setSuggestedCommits] = useState<
		Awaited<ReturnType<typeof suggestCommitsForEntry>>
	>([]);
	const [selectedCommitKeys, setSelectedCommitKeys] = useState<Set<string>>(
		new Set(),
	);
	useEffect(() => {
		if (!open) return;
		setSuggestedCommits([]);
		setSelectedCommitKeys(new Set());
	}, [open]);

	const showCommitPicker =
		!repeatEnabled &&
		!fillsDay &&
		projectId !== NO_PROJECT &&
		!!githubStatus?.connected &&
		!!linkedRepos &&
		linkedRepos.length > 0;

	// With auto-load on, the day's commits populate the picker as soon as it's
	// relevant — no "Find commits" click. When off, the manual mutation below is
	// the only source and this query stays disabled.
	const suggestedCommitsQ = useQuery({
		...suggestedCommitsQuery(projectId, targetDate),
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

	const toggleCommitSelection = (key: string) => {
		setSelectedCommitKeys((current) => {
			const next = new Set(current);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});
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
				queryKey: attachedCommitsQuery(entry.id).queryKey,
			});
		},
		onError: (error) => {
			toast.error(error.message ?? "Could not remove commit");
		},
	});

	// ── Google Calendar meeting picker ───────────────────────────────────────
	const [meetingUrl, setMeetingUrl] = useState<string | null>(null);
	const [calendarEventId, setCalendarEventId] = useState<string | null>(null);
	useEffect(() => {
		if (!open) return;
		setMeetingUrl(null);
		setCalendarEventId(null);
	}, [open]);

	const isMeetingTask = selectedTask?.name?.trim().toLowerCase() === "meeting";
	const showCalendarPicker =
		!repeatEnabled && !fillsDay && isMeetingTask && !!googleStatus?.connected;

	// Auto-load the day's meetings the moment the picker becomes relevant (the
	// Meeting task on a connected account) — no "Load meetings" click.
	const calendarEventsQ = useQuery({
		...calendarEventsForDayQuery(targetDate),
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
		form.setValue("duration", formatDurationInput(snapToQuarterHour(seconds)), {
			shouldValidate: true,
		});
		if (!form.getValues("description")) {
			form.setValue("description", event.title);
		}
		setMeetingUrl(event.meetingUrl);
		setCalendarEventId(event.id);
	};

	const toggleDay = (day: number) => {
		const current = form.getValues("daysOfWeek");
		form.setValue(
			"daysOfWeek",
			current.includes(day)
				? current.filter((d) => d !== day)
				: [...current, day].sort(),
			{ shouldValidate: true },
		);
	};

	const dialogDateLabel = (() => {
		const parts = defaultDate.split("-").map(Number);
		if (parts.length !== 3 || parts.some((p) => Number.isNaN(p)))
			return defaultDate;
		const [year, month, day] = parts;
		return new Date(
			Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1),
		).toLocaleDateString("en-US", {
			weekday: "long",
			month: "long",
			day: "numeric",
			timeZone: "UTC",
		});
	})();

	const mutation = useMutation<{ id: string }, Error, FormValues>({
		mutationFn: (values: FormValues) => {
			// Read from the submitted values rather than the render-time snapshot, so
			// what is validated is exactly what is sent.
			const parsed = parseDuration(values.duration);
			const seconds =
				parsed !== null && parsed > 0 ? snapToQuarterHour(parsed) : undefined;

			if (!entry && values.repeatEnabled) {
				return createRecurringBlockRule({
					data: {
						taskId: values.taskId,
						projectId:
							values.projectId === NO_PROJECT ? undefined : values.projectId,
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
				projectId:
					values.projectId === NO_PROJECT ? undefined : values.projectId,
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
			await queryClient.invalidateQueries({
				queryKey: [...queryKeys.timeEntries],
			});
			if (!entry) {
				await queryClient.invalidateQueries({
					queryKey: recurringBlockRulesQuery().queryKey,
				});
			}
			setOpen(false);
		},
		onError: (error) => {
			toast.error(error.message ?? "Could not save time entry");
		},
	});

	const showRepeatSection = !entry && !fillsDay && !isAbsence;

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger render={trigger} />
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{entry ? "Edit entry" : "Log time"}</DialogTitle>
					<p className="text-sm text-muted-foreground">{dialogDateLabel}</p>
				</DialogHeader>
				<Form {...form}>
					<form
						onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
						className="grid gap-4"
					>
						<FormField
							control={form.control}
							name="projectId"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Project</FormLabel>
									<Select
										value={field.value}
										onValueChange={(value) => {
											field.onChange(value);
											form.setValue("taskId", "");
										}}
										items={[
											{ value: NO_PROJECT, label: "No project (absence)" },
											...projects.map((p) => ({ value: p.id, label: p.name })),
										]}
									>
										<FormControl>
											<SelectTrigger className="w-full">
												<SelectValue placeholder="Pick a project" />
											</SelectTrigger>
										</FormControl>
										<SelectContent>
											<SelectItem value={NO_PROJECT}>
												No project (absence)
											</SelectItem>
											{projects.map((p) => (
												<SelectItem key={p.id} value={p.id}>
													{p.name}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="taskId"
							rules={{ required: "Pick a task" }}
							render={({ field }) => (
								<FormItem>
									<FormLabel>Task</FormLabel>
									<FormControl>
										<div className="flex flex-wrap gap-1.5">
											{tasks.map((t) => {
												const selected = field.value === t.id;
												return (
													<button
														key={t.id}
														type="button"
														onClick={() => field.onChange(t.id)}
														className={cn(
															"rounded-full border px-3 py-1.5 text-xs transition-colors duration-(--dur-fast)",
															selected
																? "border-primary/40 bg-primary/8 font-medium text-primary"
																: "border-border text-muted-foreground hover:bg-muted",
														)}
													>
														{t.name}
													</button>
												);
											})}
											{tasks.length === 0 && (
												<p className="text-sm text-muted-foreground">
													This project has no tasks yet — ask its lead to add
													some in project settings.
												</p>
											)}
										</div>
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						{dateOptions.length > 1 && (
							<FormField
								control={form.control}
								name="date"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Day</FormLabel>
										<Select
											value={field.value}
											onValueChange={field.onChange}
											items={dateOptions}
										>
											<FormControl>
												<SelectTrigger className="w-full">
													<SelectValue />
												</SelectTrigger>
											</FormControl>
											<SelectContent>
												{dateOptions.map((d) => (
													<SelectItem key={d.value} value={d.value}>
														{d.label}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
										<FormMessage />
									</FormItem>
								)}
							/>
						)}
						{!repeatEnabled && !isAbsence && (
							// Same hairline row as Repeat and Overtime below. It used to be a
							// tinted box, which read as a different *kind* of control when it
							// is the same kind: a toggle with a sentence under it.
							<div className="flex items-center justify-between gap-3 border-t pt-3.5">
								<div className="min-w-0">
									<span className="text-base font-medium">
										Fill rest of day
									</span>
									<p className="text-sm text-muted-foreground">
										{dayHasFill
											? "This day already has a fill block — edit or delete that one instead."
											: "Auto-expands to your working hours minus everything else logged that day."}
									</p>
								</div>
								<Switch
									checked={fillsDay}
									disabled={dayHasFill}
									onCheckedChange={(checked) =>
										form.setValue("fillsDay", checked)
									}
								/>
							</div>
						)}
						{fillsDay ? (
							<p className="text-sm text-muted-foreground">
								This entry fills the rest of the day's working hours
								automatically — no duration needed.
							</p>
						) : (
							<FormField
								control={form.control}
								name="duration"
								// A fill block's duration is derived server-side, so the box is
								// not rendered at all — but react-hook-form keeps unmounted
								// fields registered, so the rule has to stand down explicitly
								// or it would block the submit over a box nobody can see.
								rules={{
									validate: (value: string, values: FormValues) =>
										values.fillsDay ? true : validateDuration(value),
								}}
								render={({ field }) => (
									<FormItem>
										<FormLabel>Time</FormLabel>
										<FormControl>
											<Input
												{...field}
												className="w-32 text-base"
												placeholder="1.5 or 1h30m"
												// Normalise on blur, the way the week grid's cells
												// already do — "1.5" becomes "1h30m", so what is on
												// screen is what will be saved rather than a form the
												// reader has to snap in their own head.
												onBlur={(e) => {
													field.onBlur();
													const parsed = parseDuration(e.target.value);
													if (parsed !== null && parsed > 0) {
														field.onChange(
															formatDurationInput(snapToQuarterHour(parsed)),
														);
													}
												}}
											/>
										</FormControl>
										{/* The rounding hint gives way to the error: two lines of
										    small print under one box is one too many, and the
										    error is the one that needs acting on. */}
										{form.formState.errors.duration ? (
											<FormMessage />
										) : (
											<p className="text-sm text-muted-foreground">
												{willSnap && snappedSeconds != null
													? `Rounds to ${formatDurationInput(snappedSeconds)} — time is tracked in 15-minute steps.`
													: "In 15-minute steps."}
											</p>
										)}
									</FormItem>
								)}
							/>
						)}
						{showCalendarPicker && (
							<div className="border-t pt-3.5">
								<div className="flex items-center justify-between">
									<span className="text-base font-medium">Google Calendar</span>
									{calendarEventsQ.isFetching && (
										<span className="flex items-center gap-1.5 text-xs text-muted-foreground">
											<CalendarDotIcon className="size-3.5 animate-pulse" />
											Loading…
										</span>
									)}
								</div>

								{calendarEvents.length > 0 && (
									<div className="scrollbar-stable -mx-1 mt-3 max-h-52 overflow-y-auto rounded-md border">
										{calendarEvents.map((event) => {
											const selected = calendarEventId === event.id;
											return (
												<button
													key={event.id}
													type="button"
													onClick={() => pickCalendarEvent(event)}
													className={cn(
														"flex w-full items-start gap-2 border-b px-3 py-2 text-left last:border-b-0",
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
									<p className="mt-3 text-sm text-destructive">
										Could not load your calendar. Try reconnecting Google.
									</p>
								)}

								{calendarEventsQ.isSuccess && calendarEvents.length === 0 && (
									<p className="mt-3 text-sm text-muted-foreground">
										No meetings found for this day.
									</p>
								)}

								{meetingUrl && (
									<p className="mt-2 truncate text-sm text-muted-foreground">
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
							</div>
						)}
						{showRepeatSection && (
							<div className="border-t pt-3.5">
								<div className="flex items-center justify-between">
									<span className="text-base font-medium">Repeat</span>
									<Switch
										checked={repeatEnabled}
										onCheckedChange={(checked) =>
											form.setValue("repeatEnabled", checked)
										}
									/>
								</div>
								{/* A disclosure, not a bare conditional render. Flipping the
								    switch used to insert this block instantly, which jumped the
								    dialog's height and shoved the footer buttons down under
								    whatever the pointer was already over.

								    Opened with motion rather than the CSS `0fr → 1fr` grid-row
								    trick: the fields unmount when collapsed, exactly as they did
								    before this was animated, so nothing here can be tabbed into
								    or submitted while the switch is off. The grid version had to
								    keep them mounted and hold them shut with `inert` instead.
								    `springProductive` is the same spring the sidebar rows and the
								    entry rows open with.

								    `overflow-hidden` clips the content to the collapsing box; the
								    controls sit behind `mt-3` + `p-3`, so it never reaches a
								    focus ring. Reduced motion is handled globally by the root
								    <MotionConfig reducedMotion="user">. */}
								<AnimatePresence initial={false}>
									{repeatEnabled && (
										<motion.div
											key="repeat-options"
											initial={{ height: 0, opacity: 0 }}
											animate={{ height: "auto", opacity: 1 }}
											exit={{ height: 0, opacity: 0 }}
											transition={springProductive}
											className="overflow-hidden"
										>
											<div className="mt-3 flex flex-col gap-3 rounded-lg border bg-muted/40 p-3">
												<div className="flex gap-1">
													{DAY_LABELS.map((label, day) => (
														<button
															// biome-ignore lint/suspicious/noArrayIndexKey: day is the stable weekday number (0-6)
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
															{label}
														</button>
													))}
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
																{/* Genuinely optional — a repeat with no end
																    date runs until it is removed — so this is
																    the second of the two clearable pickers. */}
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
						{!isAbsence && (
							<div className="flex items-center justify-between border-t pt-3.5">
								<div className="min-w-0">
									<span className="text-base font-medium">Overtime</span>
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
						)}
						{showCommitPicker && (
							<div className="border-t pt-3.5">
								<div className="flex items-center justify-between">
									<span className="text-base font-medium">GitHub commits</span>
									{autoLoadCommits ? (
										<Button
											type="button"
											variant="outline"
											size="sm"
											onClick={() => suggestedCommitsQ.refetch()}
											disabled={suggestedCommitsQ.isFetching}
										>
											<GitCommitIcon className="size-3.5" />
											{suggestedCommitsQ.isFetching ? "Loading…" : "Refresh"}
										</Button>
									) : (
										<Button
											type="button"
											variant="outline"
											size="sm"
											onClick={() => suggestCommitsMutation.mutate()}
											disabled={suggestCommitsMutation.isPending}
										>
											<GitCommitIcon className="size-3.5" />
											{suggestCommitsMutation.isPending
												? "Finding…"
												: "Find commits"}
										</Button>
									)}
								</div>

								{attachedCommits && attachedCommits.length > 0 && (
									<div className="scrollbar-stable -mx-1 mt-3 max-h-40 overflow-y-auto rounded-md border">
										{attachedCommits.map((commit) => (
											<div
												key={commit.id}
												className="flex items-center justify-between gap-2 border-b px-3 py-2 last:border-b-0"
											>
												<span className="min-w-0 truncate text-sm">
													<span className="mono text-xs text-muted-foreground">
														{commit.sha.slice(0, 7)}
													</span>{" "}
													{commit.message.split("\n")[0]}
												</span>
												<Button
													type="button"
													variant="ghost"
													size="icon-xs"
													onClick={() => detachCommitMutation.mutate(commit.id)}
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
									<div className="scrollbar-stable -mx-1 mt-3 max-h-52 overflow-y-auto rounded-md border">
										{pickableCommits.map((commit) => {
											const key = commitKey(
												commit.projectGithubRepoId,
												commit.sha,
											);
											const selected = selectedCommitKeys.has(key);
											return (
												<label
													key={key}
													className="flex cursor-pointer items-start gap-2 border-b px-3 py-2 last:border-b-0"
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
														<span className="text-xs text-muted-foreground">
															{commit.repoFullName} · {commit.sha.slice(0, 7)}
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
										<p className="mt-3 text-sm text-muted-foreground">
											No commits found for this day.
										</p>
									)}
							</div>
						)}
						<FormField
							control={form.control}
							name="description"
							rules={
								isAbsence || fillsDay
									? undefined
									: { required: "Describe what you worked on" }
							}
							render={({ field }) => (
								<FormItem>
									<FormLabel>
										{isAbsence || fillsDay ? "Note (optional)" : "What you did"}
									</FormLabel>
									<FormControl>
										<Textarea rows={3} className="resize-y" {...field} />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<DialogFooter>
							<Button type="submit" disabled={mutation.isPending}>
								{entry
									? "Save entry"
									: repeatEnabled
										? "Create repeating entry"
										: "Log time"}
							</Button>
						</DialogFooter>
					</form>
				</Form>
			</DialogContent>
		</Dialog>
	);
}
