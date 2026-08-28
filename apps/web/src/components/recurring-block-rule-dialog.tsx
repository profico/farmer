import { formatDurationInput } from "@farmer/core/lib/time";
import { zodResolver } from "@hookform/resolvers/zod";
import {
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

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
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { cn } from "#/lib/utils.ts";
import { myProjectsQuery } from "#/queries/projects.ts";
import { recurringBlockRulesQuery } from "#/queries/recurring-block-rules.ts";
import { tasksForProjectQuery } from "#/queries/tasks.ts";
import {
	createRecurringBlockRule,
	updateRecurringBlockRule,
} from "#/server/recurring-block-rules.ts";

const NO_PROJECT = "__none__";
const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"]; // index 0=Sun..6=Sat

// No start time: a recurring block reserves an AMOUNT of time on a weekday, not
// a slot on a clock, which is the whole point of the duration-only model.
const formSchema = z
	.object({
		taskId: z.uuid("Pick a task"),
		projectId: z.string(),
		description: z.string(),
		daysOfWeek: z.array(z.number()).min(1, "Pick at least one day"),
		duration: z.string().min(1, "Duration is required"),
	})
	// Same rule the server enforces, restated against this form's shape (it uses
	// a sentinel string for "no project" rather than omitting the field). The
	// entries this rule generates are worked time and must carry a note; saying
	// so here means the answer arrives under the box rather than as a toast.
	.superRefine((data, ctx) => {
		if (data.projectId !== NO_PROJECT && !data.description.trim()) {
			ctx.addIssue({
				code: "custom",
				path: ["description"],
				message: "Describe what this block is for",
			});
		}
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
	// The task list follows the chosen project — tasks are a global taxonomy that
	// each project cherry-picks from.
	const { data: taskOptions = [] } = useSuspenseQuery(
		tasksForProjectQuery(
			orgSlug,
			projectId === NO_PROJECT ? undefined : projectId,
		),
	);

	// A rule's own task is pinned into its options while the project is unchanged,
	// because the list is what you may PICK and that is a narrower set than what a
	// rule may already hold — a task the project has since stopped offering, say.
	// Without the pin, editing such a rule showed an empty Task select and lost
	// the task on save.
	const originalProjectId = rule?.projectId ?? NO_PROJECT;
	const options =
		rule && projectId === originalProjectId
			? [
					...taskOptions
						.map((t) => ({ value: t.id, label: t.name }))
						.filter((o) => o.value !== rule.task.id),
					{ value: rule.task.id, label: rule.task.name },
				].sort((a, b) => a.label.localeCompare(b.label))
			: taskOptions.map((t) => ({ value: t.id, label: t.name }));

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
						onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
						className="grid gap-4"
					>
						<FormField
							control={form.control}
							name="taskId"
							render={({ field }) => (
								<FormItem>
									<FormLabel required>Task</FormLabel>
									<Select
										value={field.value}
										onValueChange={field.onChange}
										items={options}
									>
										<FormControl>
											<SelectTrigger className="w-full">
												<SelectValue placeholder="Select a task" />
											</SelectTrigger>
										</FormControl>
										<SelectContent>
											{options.map((t) => (
												<SelectItem key={t.value} value={t.value}>
													{t.label}
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
						<FormItem>
							<FormLabel required>Days</FormLabel>
							<div className="flex gap-1">
								{DAY_LABELS.map((label, day) => (
									<button
										// oxlint-disable-next-line react/no-array-index-key -- day is the stable weekday number (0-6), not an incidental index
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
										{label}
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
									{/* Honest either way: a rule against a project generates
								    worked time, which must say what the work was. */}
									<FormLabel required={projectId !== NO_PROJECT}>
										{projectId === NO_PROJECT ? "Note (optional)" : "Note"}
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
