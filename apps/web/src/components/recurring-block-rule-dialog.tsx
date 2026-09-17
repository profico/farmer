import { descriptionRequiredFor } from "@farmer/core/lib/task-rules";
import { formatDurationInput } from "@farmer/core/lib/time";
import { zodResolver } from "@hookform/resolvers/zod";
import {
	useMutation,
	useQuery,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { ProjectPicker } from "#/components/pickers/project-picker.tsx";
import { TaskPicker } from "#/components/pickers/task-picker.tsx";
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
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { useWeekdays } from "#/hooks/use-week-starts-on.ts";
import { cn } from "#/lib/utils.ts";
import { myProjectsQuery } from "#/queries/projects.ts";
import { recurringBlockRulesQuery } from "#/queries/recurring-block-rules.ts";
import { recentTasksQuery, tasksForProjectQuery } from "#/queries/tasks.ts";
import {
	createRecurringBlockRule,
	updateRecurringBlockRule,
} from "#/server/recurring-block-rules.ts";

const NO_PROJECT = "__none__";

// No start time: a recurring block reserves an AMOUNT of time on a weekday, not
// a slot on a clock, which is the whole point of the duration-only model.
const formSchema = z.object({
	taskId: z.uuid("Pick a task"),
	projectId: z.string(),
	description: z.string(),
	daysOfWeek: z.array(z.number()).min(1, "Pick at least one day"),
	duration: z.string().min(1, "Duration is required"),
});

type FormValues = z.infer<typeof formSchema>;

/** The shape the settings table hands back for editing — a row from
 *  `recurringBlockRulesService.list`, narrowed to what the form touches. */
export type EditableRecurringBlockRule = {
	id: string;
	taskId: string;
	task: { id: string; name: string };
	projectId: string | null;
	description: string;
	daysOfWeek: number[];
	durationSeconds: number;
};

function RecurringBlockRuleDialog({
	rule,
	trigger,
}: {
	/** Absent = create a new rule. */
	rule?: EditableRecurringBlockRule;
	trigger: React.ReactElement;
}) {
	const orgSlug = useOrgSlug();
	const [open, setOpen] = useState(false);
	const queryClient = useQueryClient();
	// A recurring block writes a time entry onto every matching day, so this is
	// an "I may log time here" picker like the others — `myProjectsQuery`, not
	// the org-wide list. Offering an unassigned project here failed later and
	// less visibly than in the add-entry dialogs: the rule saved, then wrote
	// nothing.
	const { data: projects } = useSuspenseQuery(myProjectsQuery(orgSlug));

	const defaults: FormValues = rule
		? {
				taskId: rule.taskId,
				projectId: rule.projectId ?? NO_PROJECT,
				description: rule.description,
				daysOfWeek: rule.daysOfWeek,
				duration: formatDurationInput(rule.durationSeconds),
			}
		: {
				taskId: "",
				projectId: NO_PROJECT,
				description: "",
				daysOfWeek: [1, 2, 3, 4, 5],
				duration: "30m",
			};

	const form = useForm<FormValues>({
		resolver: zodResolver(formSchema),
		defaultValues: defaults,
	});

	const projectId = form.watch("projectId");
	const daysOfWeek = form.watch("daysOfWeek");
	const weekdays = useWeekdays();
	// The task list follows the chosen project: with one it is the whole grouped
	// list, without one the short project-less list (time off and the built-ins).
	const { data: taskOptions = [] } = useSuspenseQuery(
		tasksForProjectQuery(
			orgSlug,
			projectId === NO_PROJECT ? undefined : projectId,
		),
	);
	const { data: recentIds = [] } = useQuery({
		...recentTasksQuery(orgSlug, projectId),
		enabled: open && projectId !== NO_PROJECT,
	});

	// Worked time must say what it is for; time off and a Break need not. The
	// task decides, and the rule is asked at submit against the task chosen
	// then — the same rule the server enforces, restated here so the answer
	// arrives under the box rather than as a toast.
	const taskId = form.watch("taskId");
	const selectedTask = taskOptions.find((t) => t.id === taskId);
	const needsDescription = selectedTask
		? descriptionRequiredFor(selectedTask)
		: true;

	// Checked on click only once Save has been pressed, like every other field:
	// before that, unticking the last day would already say "Pick a day".
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

	const mutation = useMutation({
		mutationFn: (values: FormValues) => {
			const projectValue =
				values.projectId === NO_PROJECT ? undefined : values.projectId;
			if (rule) {
				return updateRecurringBlockRule({
					data: {
						ruleId: rule.id,
						taskId: values.taskId,
						// Explicit null, not undefined: "No project" has to detach the
						// project, and undefined means "leave it alone".
						projectId: projectValue ?? null,
						description: values.description,
						daysOfWeek: values.daysOfWeek,
						duration: values.duration,
					},
				});
			}
			return createRecurringBlockRule({
				data: {
					taskId: values.taskId,
					projectId: projectValue,
					description: values.description || undefined,
					daysOfWeek: values.daysOfWeek,
					duration: values.duration,
				},
			});
		},
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: recurringBlockRulesQuery(orgSlug).queryKey,
			});
			setOpen(false);
			if (!rule) form.reset();
		},
		onError: (error) => {
			toast.error(error.message ?? "Could not save recurring block");
		},
	});

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				// Reopening an edit dialog after a cancelled edit should show the rule
				// as it stands, not the abandoned draft.
				if (next) form.reset(defaults);
			}}
		>
			<DialogTrigger render={trigger} />
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						{rule ? "Edit recurring block" : "New recurring block"}
					</DialogTitle>
				</DialogHeader>
				<Form {...form}>
					<form
						onSubmit={form.handleSubmit((values) => {
							if (needsDescription && !values.description.trim()) {
								form.setError("description", {
									message: "Describe what this block is for",
								});
								return;
							}
							mutation.mutate(values);
						})}
						className="grid grid-cols-[minmax(0,1fr)] gap-4"
					>
						<FormField
							control={form.control}
							name="projectId"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Project</FormLabel>
									<FormControl>
										<ProjectPicker
											projects={projects}
											noProject="No project"
											value={field.value === NO_PROJECT ? null : field.value}
											onValueChange={(next) => {
												field.onChange(next ?? NO_PROJECT);
												form.setValue("taskId", "");
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
								<FormItem>
									<FormLabel required>Task</FormLabel>
									<FormControl>
										<TaskPicker
											tasks={taskOptions}
											recentIds={recentIds}
											grouped={projectId !== NO_PROJECT}
											value={field.value}
											onValueChange={field.onChange}
										/>
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormItem>
							<FormLabel required>Days</FormLabel>
							<div className="flex gap-1">
								{weekdays.map(({ day, initial }) => (
									<button
										key={day}
										type="button"
										onClick={() => toggleDay(day)}
										className={cn(
											"size-8 rounded-full border text-sm font-medium",
											daysOfWeek.includes(day)
												? "border-primary bg-primary text-primary-foreground"
												: "border-input bg-background text-muted-foreground",
										)}
									>
										{initial}
									</button>
								))}
							</div>
							{form.formState.errors.daysOfWeek && (
								<p className="text-sm text-destructive">
									{form.formState.errors.daysOfWeek.message}
								</p>
							)}
						</FormItem>
						<FormField
							control={form.control}
							name="duration"
							render={({ field }) => (
								<FormItem>
									<FormLabel required>Duration</FormLabel>
									<FormControl>
										<Input placeholder="1.5, 30m, or 1h30m" {...field} />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="description"
							render={({ field }) => (
								<FormItem>
									{/* Honest either way: a worked-time rule generates entries
								    that must say what the work was; a Break or time off need
								    not. */}
									<FormLabel required={needsDescription}>
										{needsDescription ? "Note" : "Note (optional)"}
									</FormLabel>
									<FormControl>
										<Input {...field} />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<DialogFooter>
							<Button type="submit" disabled={mutation.isPending}>
								{rule ? "Save" : "Create"}
							</Button>
						</DialogFooter>
					</form>
				</Form>
			</DialogContent>
		</Dialog>
	);
}

export function CreateRecurringBlockRuleDialog() {
	return (
		<RecurringBlockRuleDialog
			trigger={<Button size="sm">+ New recurring block</Button>}
		/>
	);
}

export function EditRecurringBlockRuleDialog({
	rule,
}: {
	rule: EditableRecurringBlockRule;
}) {
	return (
		<RecurringBlockRuleDialog
			rule={rule}
			trigger={
				<Button variant="ghost" size="sm">
					Edit
				</Button>
			}
		/>
	);
}
