import { descriptionRequiredFor } from "@farmer/core/lib/task-rules";
import {
	parseDuration,
	snapToQuarterHour,
	timeKeyInTz,
	weekdayInTz,
} from "@farmer/core/lib/time";
import { zodResolver } from "@hookform/resolvers/zod";
import {
	CalendarDotIcon,
	CaretRightIcon,
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
import { z } from "zod";

import { ProjectPicker } from "#/components/pickers/project-picker.tsx";
import { TaskPicker } from "#/components/pickers/task-picker.tsx";
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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select.tsx";
import { Switch } from "#/components/ui/switch.tsx";
import { Textarea } from "#/components/ui/textarea.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { formatClock } from "#/lib/format-hours.ts";
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
import { recentTasksQuery, tasksForProjectQuery } from "#/queries/tasks.ts";
import { timeEntriesRangeQuery } from "#/queries/time-entries.ts";
import {
	attachCommitsToEntry,
	detachCommitFromEntry,
	suggestCommitsForEntry,
} from "#/server/github.ts";
import type { listCalendarEventsForDay } from "#/server/google-calendar.ts";
import { createRecurringBlockRule } from "#/server/recurring-block-rules.ts";
import { createTimeEntry, updateTimeEntry } from "#/server/time-entries.ts";

// Time off is chosen where a project would be: it sits first in the project
// picker, and choosing it narrows the task list to the leave kinds.
const TIME_OFF = "__time_off__";
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

const MAX_ENTRY_SECONDS = 24 * 3600;

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected yyyy-MM-dd");

const formSchema = z
	.object({
		projectId: z.string().min(1),
		taskId: z.uuid("Pick a task"),
		date: dateKey,
		duration: z.string(),
		description: z.string().max(10_000),
		// Whether the chosen task is worked time (`descriptionRequiredFor`), kept
		// on the form so the rule can be checked at submit without the schema
		// having to know the task list.
		needsDescription: z.boolean(),
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
					message: "Enter some time",
				});
			} else {
				const parsed = parseDuration(data.duration);
				if (parsed === null) {
					ctx.addIssue({
						code: "custom",
						path: ["duration"],
						message: "Try 1.5, 1h30m or 1:30",
					});
				} else if (parsed <= 0) {
					ctx.addIssue({
						code: "custom",
						path: ["duration"],
						message: "Enter some time",
					});
				} else if (snapToQuarterHour(parsed) > MAX_ENTRY_SECONDS) {
					ctx.addIssue({
						code: "custom",
						path: ["duration"],
						message: "A single entry cannot exceed 24 hours",
					});
				}
			}
		}
		if (data.needsDescription && !data.fillsDay && !data.description?.trim()) {
			ctx.addIssue({
				code: "custom",
				path: ["description"],
				message: "Describe what you worked on",
			});
		}
		if (data.repeatEnabled && data.daysOfWeek.length < 1) {
			ctx.addIssue({
				code: "custom",
				path: ["daysOfWeek"],
				message: "Pick at least one day",
			});
		}
	});

type FormValues = z.infer<typeof formSchema>;

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
	const orgSlug = useOrgSlug();
	const [open, setOpen] = useState(false);
	const queryClient = useQueryClient();
	const { data: projects } = useSuspenseQuery(myProjectsQuery(orgSlug));

	const defaultDate =
		entry?.date ?? defaultDateProp ?? dateOptions[0]?.value ?? "";

	const buildDefaults = (): FormValues => ({
		projectId: entry?.projectId ?? TIME_OFF,
		taskId: entry?.taskId ?? "",
		date: defaultDate,
		duration: entry ? formatClock(entry.durationSeconds) : "",
		description: entry?.description ?? "",
		needsDescription: true,
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

	/* oxlint-disable react-hooks/exhaustive-deps -- only reset when the dialog opens */
	useEffect(() => {
		if (!open) return;
		form.reset(buildDefaults());
	}, [open]);
	/* oxlint-enable react-hooks/exhaustive-deps */

	const projectId = form.watch("projectId");
	const taskId = form.watch("taskId");
	const targetDate = form.watch("date") || defaultDate;
	const repeatEnabled = form.watch("repeatEnabled");
	const fillsDay = form.watch("fillsDay");
	const daysOfWeek = form.watch("daysOfWeek");

	// The task list follows the project: with one it is the whole grouped list,
	// without one the short project-less list (time off and the built-ins) — so
	// switching project can leave a task chosen that no longer applies.
	const { data: tasks = [] } = useQuery({
		...tasksForProjectQuery(
			orgSlug,
			projectId === TIME_OFF ? undefined : projectId,
		),
		enabled: open,
	});
	const { data: recentIds = [] } = useQuery({
		...recentTasksQuery(orgSlug, projectId),
		enabled: open && projectId !== TIME_OFF,
	});
	const isTimeOff = projectId === TIME_OFF;
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
	// task decides, so the form learns the answer whenever the task changes.
	const needsDescription = selectedTask
		? descriptionRequiredFor(selectedTask)
		: true;
	useEffect(() => {
		form.setValue("needsDescription", needsDescription);
	}, [needsDescription, form]);

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
		enabled: open && projectId !== TIME_OFF,
	});
	const { data: attachedCommits } = useQuery({
		...attachedCommitsQuery(orgSlug, entry?.id ?? ""),
		enabled: open && !!entry,
	});
	const { data: integrationSettings } = useQuery({
		...integrationSettingsQuery(orgSlug),
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

	// Two different questions, and conflating them hid the commits on exactly the
	// entries that always have some. FINDING new commits needs a project and a
	// date to look them up by, and makes no sense on a rest-of-day fill block
	// whose commits the engine already attached. SHOWING what is attached needs
	// nothing but the attachments — a project-less fill block is the commit
	// engine's own output, so it is the one entry guaranteed to have them.
	const showCommitPicker =
		!repeatEnabled &&
		!fillsDay &&
		projectId !== TIME_OFF &&
		!!githubStatus?.connected &&
		!!linkedRepos &&
		linkedRepos.length > 0;
	const showAttachedCommits =
		!repeatEnabled && !!attachedCommits && attachedCommits.length > 0;
	const showCommitSection = showCommitPicker || showAttachedCommits;

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
				queryKey: attachedCommitsQuery(orgSlug, entry.id).queryKey,
			});
		},
		onError: (error) => {
			toast.error(error.message ?? "Could not remove commit");
		},
	});

	// ── Google Calendar meeting picker ───────────────────────────────────────
	const [meetingUrl, setMeetingUrl] = useState<string | null>(null);
	const [calendarEventId, setCalendarEventId] = useState<string | null>(null);
	// The three switches live behind "More options", and the two pull-in lists
	// behind their footer links: a fresh dialog shows the entry and nothing else.
	const [moreOpen, setMoreOpen] = useState(false);
	const [calendarOpen, setCalendarOpen] = useState(false);
	const [commitsOpen, setCommitsOpen] = useState(false);
	useEffect(() => {
		if (!open) return;
		setMeetingUrl(null);
		setCalendarEventId(null);
		setMoreOpen(false);
		setCalendarOpen(false);
		setCommitsOpen(false);
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
							values.projectId === TIME_OFF ? undefined : values.projectId,
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
				projectId: values.projectId === TIME_OFF ? undefined : values.projectId,
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
			setOpen(false);
		},
		onError: (error) => {
			toast.error(error.message ?? "Could not save time entry");
		},
	});

	const showRepeatSection = !entry && !fillsDay && !isAbsence;
	const activeOptions = [
		fillsDay ? "Fill rest of day" : null,
		repeatEnabled ? "Repeat" : null,
		form.watch("overtime") ? "Overtime" : null,
	].flatMap((o) => (o ? [o] : []));

	const submit = (values: FormValues) => mutation.mutate(values);
	// ⌘↩ / Ctrl+↩ saves from anywhere in the dialog — the textarea, where a
	// plain Enter is a new line, and the pickers, whose popups are portaled
	// outside the form and so never see a form-level key handler.
	const { mutate } = mutation;
	useEffect(() => {
		if (!open) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
			event.preventDefault();
			void form.handleSubmit((values) => mutate(values))();
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [open, form, mutate]);

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger render={trigger} />
			<DialogContent className="sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>{entry ? "Edit entry" : "Log time"}</DialogTitle>
					<p className="text-sm text-muted-foreground">{dialogDateLabel}</p>
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
						{/* One label over the two pickers, the way Harvest stacks them:
						    the project decides the task list, so they read as one choice. */}
						<div className="grid gap-1.5">
							<span className="text-sm leading-none font-medium text-muted-foreground">
								Project / Task
							</span>
							<div className="grid gap-2">
								<FormField
									control={form.control}
									name="projectId"
									render={({ field }) => (
										<FormItem className="gap-1">
											<FormControl>
												<ProjectPicker
													aria-label="Project"
													projects={projects}
													noProject="Time-off"
													value={field.value === TIME_OFF ? null : field.value}
													onValueChange={(next) => {
														const wasTimeOff = field.value === TIME_OFF;
														field.onChange(next ?? TIME_OFF);
														form.setValue("taskId", "");
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
										<FormItem className="gap-1">
											<FormControl>
												<TaskPicker
													aria-label="Task"
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
												/>
											</FormControl>
											<FormMessage />
										</FormItem>
									)}
								/>
							</div>
						</div>
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
						{/* What you did, and how long: side by side, the time box big
						    enough to be the thing you read back. */}
						<div className="grid gap-1.5">
							<div className="grid grid-cols-[minmax(0,1fr)_9.5rem] gap-2.5 max-sm:grid-cols-[minmax(0,1fr)]">
								<FormField
									control={form.control}
									name="description"
									render={({ field }) => (
										<FormItem className="gap-1">
											<FormControl>
												<Textarea
													rows={3}
													className="min-h-22 resize-y"
													aria-label={
														needsDescription && !fillsDay
															? "What you did"
															: "Note (optional)"
													}
													placeholder={
														needsDescription && !fillsDay
															? "What did you work on?"
															: "Note (optional)"
													}
													{...field}
												/>
											</FormControl>
											<FormMessage />
										</FormItem>
									)}
								/>
								{fillsDay ? (
									<div className="flex min-h-22 items-center justify-center rounded-lg border border-dashed border-input px-3 text-center text-sm text-muted-foreground">
										Rest of day
									</div>
								) : (
									<FormField
										control={form.control}
										name="duration"
										render={({ field }) => (
											<FormItem className="gap-1">
												<FormControl>
													<Input
														{...field}
														aria-label="Time"
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
												<FormMessage />
											</FormItem>
										)}
									/>
								)}
							</div>
							{/* The rounding hint gives way to the error above: two lines of
							    small print under one box is one too many. */}
							{!form.formState.errors.duration && (
								<p className="text-sm text-muted-foreground">
									{fillsDay
										? "Fills the rest of your working hours, minus everything else logged that day."
										: willSnap && snappedSeconds != null
											? `Rounds to ${formatClock(snappedSeconds)} — time is tracked in 15-minute steps.`
											: "Type 1.5, 1h30m or 1:30 — tracked in 15-minute steps."}
								</p>
							)}
						</div>
						{showCalendarPicker && calendarOpen && (
							<div className="rounded-lg border border-line2">
								<div className="flex items-center justify-between px-3 py-2">
									<span className="text-sm font-medium">Google Calendar</span>
									{calendarEventsQ.isFetching && (
										<span className="flex items-center gap-1.5 text-xs text-muted-foreground">
											<CalendarDotIcon className="size-3.5 animate-pulse" />
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
						{showCommitSection && (commitsOpen || showAttachedCommits) && (
							<div className="rounded-lg border border-line2">
								<div className="flex min-h-10 items-center justify-between px-3 py-1">
									<span className="text-sm font-medium">GitHub commits</span>
									{!showCommitPicker ? null : autoLoadCommits ? (
										<Button
											type="button"
											variant="ghost"
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
											variant="ghost"
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
													className="shrink-0"
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
										<p className="border-t border-line2 px-3 py-2 text-sm text-muted-foreground">
											No commits found for this day.
										</p>
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
										<span className="text-foreground">
											· {activeOptions.join(", ")}
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
											transition={springProductive}
											className="overflow-hidden"
										>
											<div className="grid divide-y divide-line2 pt-1">
												{!repeatEnabled && (
													<div className="flex items-center justify-between gap-3 py-3">
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
																	transition={springProductive}
																	className="overflow-hidden"
																>
																	<div className="mt-3 flex flex-col gap-3">
																		<div className="flex gap-1">
																			{DAY_LABELS.map((label, day) => (
																				<button
																					// oxlint-disable-next-line react/no-array-index-key -- day is the stable weekday number (0-6)
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
																		{form.formState.errors.daysOfWeek && (
																			<p className="text-sm text-destructive">
																				{
																					form.formState.errors.daysOfWeek
																						.message
																				}
																			</p>
																		)}
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
						<DialogFooter className="sm:justify-start">
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
							<DialogClose render={<Button type="button" variant="outline" />}>
								Cancel
							</DialogClose>
							{(showCalendarPicker || showCommitPicker) && (
								<div className="flex flex-wrap items-center gap-x-4 gap-y-1 sm:ml-auto">
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
												setCommitsOpen((current) => !current);
												if (
													!autoLoadCommits &&
													!suggestCommitsMutation.isSuccess
												) {
													suggestCommitsMutation.mutate();
												}
											}}
										>
											<GitCommitIcon className="size-4" />
											Pull in commits
										</Button>
									)}
								</div>
							)}
						</DialogFooter>
					</form>
				</Form>
			</DialogContent>
		</Dialog>
	);
}
