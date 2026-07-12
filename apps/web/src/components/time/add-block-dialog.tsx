import {
	dayKeyInTz,
	formatDurationInput,
	parseDuration,
	timeKeyInTz,
	weekdayInTz,
} from "@farmer/core/lib/time";
import {
	useMutation,
	useQuery,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { CalendarClock, GitCommitHorizontal, Video, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
import { cn } from "#/lib/utils.ts";
import { availableEntryTypesQuery } from "#/queries/entry-types.ts";
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
import { myProjectsQuery } from "#/queries/projects.ts";
import { recurringBlockRulesQuery } from "#/queries/recurring-block-rules.ts";
import { timeEntriesRangeQuery } from "#/queries/time-entries.ts";
import { workingHoursQuery } from "#/queries/working-hours.ts";
import {
	attachCommitsToEntry,
	detachCommitFromEntry,
	suggestCommitsForEntry,
} from "#/server/github.ts";
import type { listCalendarEventsForDay } from "#/server/google-calendar.ts";
import { createRecurringBlockRule } from "#/server/recurring-block-rules.ts";
import { createTimeEntry, updateTimeEntry } from "#/server/time-entries.ts";

const NO_PROJECT = "__none__";
const NO_TASK = "__none__";
const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"]; // index 0=Sun..6=Sat

export type ExistingTimeEntry = {
	id: string;
	typeId: string;
	projectId: string | null;
	taskId: string | null;
	description: string;
	durationSeconds: number;
	startedAt: string | Date;
	billable: boolean;
	fillsDay: boolean;
	generatedFromRuleId: string | null;
};

type FormValues = {
	typeId: string;
	projectId: string;
	taskId: string;
	date: string;
	startTime: string;
	endTime: string;
	description: string;
	billable: boolean;
	fillsDay: boolean;
	repeatEnabled: boolean;
	daysOfWeek: number[];
	repeatEndDate: string;
};

function minutesBetween(start: string, end: string): number {
	const [sh, sm] = start.split(":").map(Number);
	const [eh, em] = end.split(":").map(Number);
	return eh * 60 + (em ?? 0) - (sh * 60 + (sm ?? 0));
}

function addMinutesToTime(time: string, minutes: number): string {
	const [h, m] = time.split(":").map(Number);
	const total = ((((h ?? 0) * 60 + (m ?? 0) + minutes) % 1440) + 1440) % 1440;
	return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function commitKey(projectGithubRepoId: string, sha: string): string {
	return `${projectGithubRepoId}:${sha}`;
}

// Where a new block should start when the user hasn't picked a time: right
// after the last block already logged that day, or the day's configured
// working-hours start if nothing's logged yet.
function anchorStartTime({
	dayEntries,
	workingHours,
	targetDate,
	timezone,
}: {
	dayEntries: { startedAt: string | Date; durationSeconds: number }[];
	workingHours: {
		dayOfWeek: number;
		enabled: boolean;
		startTime: string | null;
	}[];
	targetDate: string;
	timezone: string;
}): string {
	if (dayEntries.length > 0) {
		const latestEndMinutes = Math.max(
			...dayEntries.map((e) => {
				const [h, m] = timeKeyInTz(new Date(e.startedAt), timezone)
					.split(":")
					.map(Number);
				return (h ?? 0) * 60 + (m ?? 0) + Math.round(e.durationSeconds / 60);
			}),
		);
		return addMinutesToTime("00:00", latestEndMinutes);
	}
	const day = workingHours.find(
		(d) => d.dayOfWeek === weekdayInTz(targetDate, timezone),
	);
	return day?.enabled && day.startTime ? day.startTime : "09:00";
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
	const { data: availableTypes } = useSuspenseQuery(availableEntryTypesQuery());

	const defaultDate = entry
		? dayKeyInTz(new Date(entry.startedAt), timezone)
		: (defaultDateProp ?? dateOptions[0]?.value ?? "");

	const defaultStartTime = entry
		? timeKeyInTz(new Date(entry.startedAt), timezone)
		: "09:00";
	const defaultEndTime = entry
		? timeKeyInTz(
				new Date(
					new Date(entry.startedAt).getTime() + entry.durationSeconds * 1000,
				),
				timezone,
			)
		: "10:00";

	const buildDefaults = (): FormValues => ({
		typeId: entry?.typeId ?? "",
		projectId: entry?.projectId ?? NO_PROJECT,
		taskId: entry?.taskId ?? NO_TASK,
		date: defaultDate,
		startTime: defaultStartTime,
		endTime: defaultEndTime,
		description: entry?.description ?? "",
		billable: entry?.billable ?? true,
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
	const selectedProject = projects.find((p) => p.id === projectId);
	const typeOptions = [
		...availableTypes,
		...(selectedProject?.entryTypes ?? []),
	];
	const startTime = form.watch("startTime");
	const endTime = form.watch("endTime");
	const targetDate = form.watch("date") || defaultDate;
	const repeatEnabled = form.watch("repeatEnabled");
	const fillsDay = form.watch("fillsDay");
	const daysOfWeek = form.watch("daysOfWeek");
	const durationMinutes = minutesBetween(startTime, endTime);

	const [showExactTime, setShowExactTime] = useState(!!entry);
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset the exact-time disclosure whenever the dialog (re)opens
	useEffect(() => {
		if (open) setShowExactTime(!!entry);
	}, [open]);

	// A free-text mirror of startTime/endTime — typing here recomputes endTime
	// instead of requiring both clock times to be set by hand. Re-derived from
	// the times whenever they change elsewhere, but only on blur here so it
	// doesn't fight the user's keystrokes while they're still typing.
	const [durationText, setDurationText] = useState(
		formatDurationInput(Math.max(durationMinutes, 0) * 60),
	);
	// biome-ignore lint/correctness/useExhaustiveDependencies: only re-derive when start/end/open change, not on every durationText edit
	useEffect(() => {
		setDurationText(formatDurationInput(Math.max(durationMinutes, 0) * 60));
	}, [startTime, endTime, open]);

	const commitDuration = () => {
		const seconds = parseDuration(durationText);
		if (!seconds || seconds <= 0) {
			setDurationText(formatDurationInput(Math.max(durationMinutes, 0) * 60));
			return;
		}
		form.setValue(
			"endTime",
			addMinutesToTime(startTime, Math.round(seconds / 60)),
		);
	};

	// For a brand-new block, anchor the start time to "right after the last
	// block logged that day" (or the day's working-hours start if none yet)
	// so quick-adding just needs a duration — no clock times required. Only
	// applies until the user directly edits the Start field themselves.
	const startTimeTouchedRef = useRef(false);
	useEffect(() => {
		if (!open) startTimeTouchedRef.current = false;
	}, [open]);

	const { data: dayEntries } = useQuery({
		...timeEntriesRangeQuery(targetDate, targetDate),
		enabled: open && !entry,
	});
	const { data: workingHours } = useQuery({
		...workingHoursQuery(),
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

	const selectedType = typeOptions.find((t) => t.id === form.watch("typeId"));
	const isMeetingType = selectedType?.name?.trim().toLowerCase() === "meeting";
	const showCalendarPicker =
		!repeatEnabled && !fillsDay && isMeetingType && !!googleStatus?.connected;

	// Auto-load the day's meetings the moment the picker becomes relevant (a
	// Meeting type on a connected account) — no "Load meetings" click. Refetches
	// automatically when the target day changes.
	const calendarEventsQ = useQuery({
		...calendarEventsForDayQuery(targetDate),
		enabled: open && showCalendarPicker,
	});
	const calendarEvents = calendarEventsQ.data ?? [];

	const pickCalendarEvent = (
		event: Awaited<ReturnType<typeof listCalendarEventsForDay>>[number],
	) => {
		// A picked meeting owns the time — mark the start as user-touched so the
		// auto-anchor won't override it, and reveal the exact-time fields so the
		// filled range stays visible and editable.
		startTimeTouchedRef.current = true;
		form.setValue("startTime", timeKeyInTz(new Date(event.start), timezone));
		form.setValue("endTime", timeKeyInTz(new Date(event.end), timezone));
		setShowExactTime(true);
		if (!form.getValues("description")) {
			form.setValue("description", event.title);
		}
		setMeetingUrl(event.meetingUrl);
		setCalendarEventId(event.id);
	};

	// biome-ignore lint/correctness/useExhaustiveDependencies: re-anchors whenever the target day or its data changes, as long as the user hasn't manually set a start time
	useEffect(() => {
		if (!open || entry || startTimeTouchedRef.current) return;
		if (!dayEntries || !workingHours) return;
		const anchored = anchorStartTime({
			dayEntries,
			workingHours,
			targetDate,
			timezone,
		});
		if (anchored === form.getValues("startTime")) return;
		const duration = Math.max(
			minutesBetween(form.getValues("startTime"), form.getValues("endTime")),
			60,
		);
		form.setValue("startTime", anchored);
		form.setValue("endTime", addMinutesToTime(anchored, duration));
	}, [open, entry, dayEntries, workingHours, targetDate, timezone]);

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
			if (!entry && values.repeatEnabled) {
				return createRecurringBlockRule({
					data: {
						typeId: values.typeId,
						projectId:
							values.projectId === NO_PROJECT ? undefined : values.projectId,
						description: values.description || undefined,
						daysOfWeek: values.daysOfWeek,
						startTime: values.startTime,
						duration: formatDurationInput(
							Math.max(minutesBetween(values.startTime, values.endTime), 1) *
								60,
						),
						effectiveFrom: values.date,
						effectiveUntil: values.repeatEndDate || undefined,
					},
				});
			}
			const payload = {
				typeId: values.typeId,
				projectId:
					values.projectId === NO_PROJECT ? undefined : values.projectId,
				taskId: values.taskId === NO_TASK ? undefined : values.taskId,
				description: values.description || undefined,
				date: values.date,
				startTime: values.startTime,
				// A fill block carries no real end — its duration is derived server-side
				// from the day's remaining working hours — so end mirrors start.
				endTime: values.fillsDay ? values.startTime : values.endTime,
				billable: values.billable,
				fillsDay: values.fillsDay || undefined,
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
			await queryClient.invalidateQueries({ queryKey: ["time-entries"] });
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

	const showRepeatSection = !entry && !fillsDay;

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger render={trigger} />
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{entry ? "Edit block" : "Add time block"}</DialogTitle>
					<p className="text-sm text-muted-foreground">{dialogDateLabel}</p>
				</DialogHeader>
				<Form {...form}>
					<form
						onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
						className="grid gap-4"
					>
						<FormField
							control={form.control}
							name="typeId"
							rules={{ required: "Type is required" }}
							render={({ field }) => (
								<FormItem>
									<FormLabel>Entry type</FormLabel>
									<FormControl>
										<div className="flex flex-wrap gap-1.5">
											{typeOptions.map((t) => {
												const selected = field.value === t.id;
												return (
													<button
														key={t.id}
														type="button"
														onClick={() => field.onChange(t.id)}
														className={cn(
															"rounded-full border px-3 py-1.5 text-xs font-semibold",
															selected
																? "border-primary bg-accent text-primary"
																: "border-border text-muted-foreground",
														)}
													>
														{t.name}
													</button>
												);
											})}
										</div>
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="projectId"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Project (optional)</FormLabel>
									<Select
										value={field.value}
										onValueChange={(value) => {
											field.onChange(value);
											form.setValue("taskId", NO_TASK);
										}}
										items={[
											{ value: NO_PROJECT, label: "No project" },
											...projects.map((p) => ({ value: p.id, label: p.name })),
										]}
									>
										<FormControl>
											<SelectTrigger className="w-full">
												<SelectValue placeholder="No project" />
											</SelectTrigger>
										</FormControl>
										<SelectContent>
											<SelectItem value={NO_PROJECT}>No project</SelectItem>
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
						{selectedProject && selectedProject.tasks.length > 0 && (
							<FormField
								control={form.control}
								name="taskId"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Task (optional)</FormLabel>
										<Select
											value={field.value}
											onValueChange={field.onChange}
											items={[
												{ value: NO_TASK, label: "No task" },
												...selectedProject.tasks.map((t) => ({
													value: t.id,
													label: t.name,
												})),
											]}
										>
											<FormControl>
												<SelectTrigger className="w-full">
													<SelectValue placeholder="No task" />
												</SelectTrigger>
											</FormControl>
											<SelectContent>
												<SelectItem value={NO_TASK}>No task</SelectItem>
												{selectedProject.tasks.map((t) => (
													<SelectItem key={t.id} value={t.id}>
														{t.name}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
										<FormMessage />
									</FormItem>
								)}
							/>
						)}
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
						{!repeatEnabled && (
							<div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/40 px-3 py-2.5">
								<div className="min-w-0">
									<span className="text-sm font-semibold">
										Fill rest of day
									</span>
									<p className="text-xs text-muted-foreground">
										{dayHasFill
											? "This day already has a fill block — edit or delete that one instead."
											: "Auto-expands to your working hours minus everything else logged that day."}
									</p>
								</div>
								<Switch
									checked={fillsDay}
									disabled={dayHasFill}
									onCheckedChange={(checked) => {
										form.setValue("fillsDay", checked);
										if (checked) setShowExactTime(false);
									}}
								/>
							</div>
						)}
						{fillsDay ? (
							<p className="text-sm text-muted-foreground">
								This block fills the rest of the day's working hours
								automatically — no duration needed.
							</p>
						) : (
							<>
								<FormItem>
									<FormLabel>Duration</FormLabel>
									<FormControl>
										<Input
											className="w-28 text-base"
											placeholder="1.5 or 1h30m"
											value={durationText}
											onChange={(e) => setDurationText(e.target.value)}
											onBlur={commitDuration}
										/>
									</FormControl>
								</FormItem>
								{showExactTime ? (
									<div className="grid grid-cols-2 gap-2.5">
										<FormField
											control={form.control}
											name="startTime"
											rules={{ required: true }}
											render={({ field }) => (
												<FormItem>
													<FormLabel>Start</FormLabel>
													<FormControl>
														<Input
															type="time"
															className="text-base"
															{...field}
															onChange={(e) => {
																startTimeTouchedRef.current = true;
																field.onChange(e);
															}}
														/>
													</FormControl>
												</FormItem>
											)}
										/>
										<FormField
											control={form.control}
											name="endTime"
											rules={{ required: true }}
											render={({ field }) => (
												<FormItem>
													<FormLabel>End</FormLabel>
													<FormControl>
														<Input
															type="time"
															className="text-base"
															{...field}
														/>
													</FormControl>
												</FormItem>
											)}
										/>
									</div>
								) : (
									<button
										type="button"
										onClick={() => setShowExactTime(true)}
										className="w-fit text-sm text-primary hover:underline"
									>
										Set exact time
									</button>
								)}
							</>
						)}
						{showCalendarPicker && (
							<div className="border-t pt-3.5">
								<div className="flex items-center justify-between">
									<span className="text-sm font-semibold">Google Calendar</span>
									{calendarEventsQ.isFetching && (
										<span className="flex items-center gap-1.5 text-xs text-muted-foreground">
											<CalendarClock className="size-3.5 animate-pulse" />
											Loading…
										</span>
									)}
								</div>

								{calendarEvents.length > 0 && (
									<div className="-mx-1 mt-3 max-h-52 overflow-y-auto rounded-md border">
										{calendarEvents.map((event) => {
											const selected = calendarEventId === event.id;
											return (
												<button
													key={event.id}
													type="button"
													onClick={() => pickCalendarEvent(event)}
													className={cn(
														"flex w-full items-start gap-2 border-b px-3 py-2 text-left last:border-b-0",
														selected && "bg-accent",
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
														<Video className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
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
									<p className="mt-2 truncate text-xs text-muted-foreground">
										Meeting link:{" "}
										<a
											href={meetingUrl}
											target="_blank"
											rel="noreferrer"
											className="text-primary hover:underline"
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
									<span className="text-sm font-semibold">Repeat</span>
									<Switch
										checked={repeatEnabled}
										onCheckedChange={(checked) =>
											form.setValue("repeatEnabled", checked)
										}
									/>
								</div>
								{repeatEnabled && (
									<div className="mt-3 flex flex-col gap-3 rounded-lg border bg-muted/40 p-3">
										<div className="flex gap-1">
											{DAY_LABELS.map((label, day) => (
												<button
													// biome-ignore lint/suspicious/noArrayIndexKey: day is the stable weekday number (0-6)
													key={day}
													type="button"
													onClick={() => toggleDay(day)}
													className={cn(
														"size-7 rounded-full border text-xs font-semibold",
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
														<Input type="date" {...field} />
													</FormControl>
												</FormItem>
											)}
										/>
									</div>
								)}
							</div>
						)}
						<div className="flex items-center justify-between border-t pt-3.5">
							<span className="text-sm font-semibold">Billable</span>
							<FormField
								control={form.control}
								name="billable"
								render={({ field }) => (
									<Switch
										checked={field.value}
										onCheckedChange={field.onChange}
									/>
								)}
							/>
						</div>
						{showCommitPicker && (
							<div className="border-t pt-3.5">
								<div className="flex items-center justify-between">
									<span className="text-sm font-semibold">GitHub commits</span>
									{autoLoadCommits ? (
										<Button
											type="button"
											variant="outline"
											size="sm"
											onClick={() => suggestedCommitsQ.refetch()}
											disabled={suggestedCommitsQ.isFetching}
										>
											<GitCommitHorizontal className="size-3.5" />
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
											<GitCommitHorizontal className="size-3.5" />
											{suggestCommitsMutation.isPending
												? "Finding…"
												: "Find commits"}
										</Button>
									)}
								</div>

								{attachedCommits && attachedCommits.length > 0 && (
									<div className="-mx-1 mt-3 max-h-40 overflow-y-auto rounded-md border">
										{attachedCommits.map((commit) => (
											<div
												key={commit.id}
												className="flex items-center justify-between gap-2 border-b px-3 py-2 last:border-b-0"
											>
												<span className="min-w-0 truncate text-sm">
													<span className="font-mono text-xs text-muted-foreground">
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
													<XIcon className="size-3" />
													<span className="sr-only">Remove</span>
												</Button>
											</div>
										))}
									</div>
								)}

								{pickableCommits.length > 0 && (
									<div className="-mx-1 mt-3 max-h-52 overflow-y-auto rounded-md border">
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
							render={({ field }) => (
								<FormItem>
									<FormLabel>Note (optional)</FormLabel>
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
									? "Save block"
									: repeatEnabled
										? "Create repeating block"
										: "Add block"}
							</Button>
						</DialogFooter>
					</form>
				</Form>
			</DialogContent>
		</Dialog>
	);
}
