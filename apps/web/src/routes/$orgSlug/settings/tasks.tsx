import { createTaskInput } from "@farmer/core/schema";
import { zodResolver } from "@hookform/resolvers/zod";
import {
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { ColorPicker } from "#/components/color-picker.tsx";
import { ManageTaskProjectsDialog } from "#/components/manage-task-projects-dialog.tsx";
import { StatusPill } from "#/components/status-pill.tsx";
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
import { Page, PageHeader } from "#/components/ui/page-header.tsx";
import { RowActions } from "#/components/ui/row-actions.tsx";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import {
	CATEGORY_COLORS,
	resolveCategoryColor,
} from "#/lib/category-colors.ts";
import { formatDateKeyLong } from "#/lib/format-date.ts";
import { projectsQuery } from "#/queries/projects.ts";
import { managedTasksQuery } from "#/queries/tasks.ts";
import { requireOrgAdmin } from "#/server/auth.ts";
import {
	archiveTask,
	createTask,
	unarchiveTask,
	updateTask,
} from "#/server/tasks.ts";

export const Route = createFileRoute("/$orgSlug/settings/tasks")({
	beforeLoad: async () => {
		await requireOrgAdmin();
	},
	loader: async ({ context, params }) => {
		const orgSlug = params.orgSlug;
		// The projects list is what the "Manage projects" dialog picks from —
		// prefetched here so opening it doesn't flash a loading line.
		await Promise.all([
			context.queryClient.ensureQueryData(managedTasksQuery(orgSlug)),
			context.queryClient.ensureQueryData(projectsQuery(orgSlug)),
		]);
	},
	component: TasksPage,
});

const DEFAULT_COLOR = CATEGORY_COLORS[0].dot;

function CreateTaskDialog() {
	const orgSlug = useOrgSlug();
	const [open, setOpen] = useState(false);
	const queryClient = useQueryClient();
	const form = useForm<z.infer<typeof createTaskInput>>({
		resolver: zodResolver(createTaskInput),
		defaultValues: { name: "", color: DEFAULT_COLOR, description: "" },
	});

	const mutation = useMutation({
		mutationFn: (data: z.infer<typeof createTaskInput>) => createTask({ data }),
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: managedTasksQuery(orgSlug).queryKey,
			});
			setOpen(false);
			form.reset({ name: "", color: DEFAULT_COLOR, description: "" });
		},
		onError: (error) => toast.error(error.message ?? "Could not create task"),
	});

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger render={<Button>+ New task</Button>} />
			<DialogContent>
				<DialogHeader>
					<DialogTitle>New task</DialogTitle>
				</DialogHeader>
				<Form {...form}>
					<form
						onSubmit={form.handleSubmit((data) => mutation.mutate(data))}
						className="grid grid-cols-[minmax(0,1fr)] gap-4"
					>
						<FormField
							control={form.control}
							name="name"
							render={({ field }) => (
								<FormItem>
									<FormLabel required>Name</FormLabel>
									<FormControl>
										<Input autoFocus {...field} />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="color"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Color</FormLabel>
									<FormControl>
										<ColorPicker
											value={field.value ?? DEFAULT_COLOR}
											onChange={field.onChange}
										/>
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
									<FormLabel>Description (optional)</FormLabel>
									<FormControl>
										<Input {...field} value={field.value ?? ""} />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<DialogFooter>
							<Button type="submit" disabled={mutation.isPending}>
								Create
							</Button>
						</DialogFooter>
					</form>
				</Form>
			</DialogContent>
		</Dialog>
	);
}

type EditableTask = {
	id: string;
	name: string;
	color: string | null;
	description: string | null;
};

function EditTaskDialog({
	task,
	onOpenChange,
}: {
	task: EditableTask | null;
	onOpenChange: (open: boolean) => void;
}) {
	const orgSlug = useOrgSlug();
	const open = task !== null;
	const queryClient = useQueryClient();
	const form = useForm<z.infer<typeof createTaskInput>>({
		resolver: zodResolver(createTaskInput),
		defaultValues: { name: "", color: DEFAULT_COLOR, description: "" },
	});

	// One dialog serves every row, so the fields are re-seeded each time it opens
	// on a different task rather than at mount.
	const { reset } = form;
	useEffect(() => {
		if (task) {
			reset({
				name: task.name,
				color: task.color ?? DEFAULT_COLOR,
				description: task.description ?? "",
			});
		}
	}, [task, reset]);

	const mutation = useMutation({
		mutationFn: (data: z.infer<typeof createTaskInput>) =>
			updateTask({ data: { taskId: task?.id ?? "", ...data } }),
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: managedTasksQuery(orgSlug).queryKey,
			});
			onOpenChange(false);
		},
		onError: (error) => toast.error(error.message ?? "Could not save the task"),
	});

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Edit task</DialogTitle>
				</DialogHeader>
				<Form {...form}>
					<form
						onSubmit={form.handleSubmit((data) => mutation.mutate(data))}
						className="grid grid-cols-[minmax(0,1fr)] gap-4"
					>
						<FormField
							control={form.control}
							name="name"
							render={({ field }) => (
								<FormItem>
									<FormLabel required>Name</FormLabel>
									<FormControl>
										<Input autoFocus {...field} />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="color"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Color</FormLabel>
									<FormControl>
										<ColorPicker
											value={field.value ?? DEFAULT_COLOR}
											onChange={field.onChange}
										/>
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
									<FormLabel>Description (optional)</FormLabel>
									<FormControl>
										<Input {...field} value={field.value ?? ""} />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<DialogFooter>
							<Button
								type="button"
								variant="ghost"
								onClick={() => onOpenChange(false)}
								disabled={mutation.isPending}
							>
								Cancel
							</Button>
							<Button type="submit" disabled={mutation.isPending}>
								{mutation.isPending ? "Saving…" : "Save"}
							</Button>
						</DialogFooter>
					</form>
				</Form>
			</DialogContent>
		</Dialog>
	);
}

function TasksPage() {
	const orgSlug = useOrgSlug();
	const queryClient = useQueryClient();
	const { data: tasks } = useSuspenseQuery(managedTasksQuery(orgSlug));
	const [manageProjectsTaskId, setManageProjectsTaskId] = useState<
		string | null
	>(null);
	const [editTaskId, setEditTaskId] = useState<string | null>(null);

	// Archived tasks are hidden by default. Archiving means "stop showing me
	// this", and interleaving the dead rows with the live ones is what made a
	// screen with several same-named archived copies unreadable.
	const [showArchived, setShowArchived] = useState(false);
	const archivedCount = tasks.filter((t) => t.archivedAt).length;
	const visible = showArchived ? tasks : tasks.filter((t) => !t.archivedAt);

	const invalidate = () =>
		queryClient.invalidateQueries({
			queryKey: managedTasksQuery(orgSlug).queryKey,
		});

	const archiveMutation = useMutation({
		mutationFn: (taskId: string) => archiveTask({ data: taskId }),
		onSuccess: invalidate,
		onError: (error) => toast.error(error.message ?? "Could not archive task"),
	});

	const unarchiveMutation = useMutation({
		mutationFn: (taskId: string) => unarchiveTask({ data: taskId }),
		onSuccess: invalidate,
		onError: (error) => toast.error(error.message ?? "Could not restore task"),
	});

	return (
		<Page className="screen">
			<PageHeader
				eyebrow="Workspace"
				title="Tasks"
				lede={`One global list for the whole company.`}
				action={<CreateTaskDialog />}
				className="mb-0"
			/>

			{archivedCount > 0 && (
				<div className="mt-4 flex justify-end">
					<Button
						variant="ghost"
						size="sm"
						onClick={() => setShowArchived((shown) => !shown)}
					>
						{showArchived ? "Hide archived" : `Show ${archivedCount} archived`}
					</Button>
				</div>
			)}

			<Table containerClassName="mt-6">
				<TableHeader>
					<TableRow>
						<TableHead>Task</TableHead>
						<TableHead>Kind</TableHead>
						<TableHead className="text-right">Projects</TableHead>
						<TableHead className="text-right">Entries</TableHead>
						<TableHead>Status</TableHead>
						<TableHead />
					</TableRow>
				</TableHeader>
				<TableBody>
					{visible.map((task) => {
						const category = resolveCategoryColor(task.color);
						const builtIn = task.scope === "site";
						return (
							<TableRow key={task.id}>
								<TableCell className="font-medium">
									<span className="flex items-center gap-2">
										<span
											className="size-2 shrink-0 rounded-full"
											style={{ backgroundColor: category.dot }}
										/>
										{task.name}
									</span>
								</TableCell>
								<TableCell className="text-muted-foreground">
									{task.isAbsence
										? "Absence"
										: builtIn
											? "Built-in"
											: "Org task"}
								</TableCell>
								{/* Absence tasks are never on a project, so a 0 there would read
								    as "none yet" rather than "not applicable". Built-ins are on
								    every project without being picked, so a count would read as
								    a limit that isn't there. */}
								<TableCell className="mono text-right">
									{task.isAbsence ? (
										<span className="text-faint">—</span>
									) : task.universal ? (
										<span className="text-muted-foreground">All</span>
									) : (
										task.projectCount
									)}
								</TableCell>
								<TableCell className="mono text-right">
									{task.entryCount}
								</TableCell>
								<TableCell>
									<StatusPill tone={task.archivedAt ? "neutral" : "positive"}>
										{task.archivedAt ? "Archived" : "Active"}
									</StatusPill>
									{/* Dated, because the name alone doesn't distinguish two
									    archived copies of the same task from each other. */}
									{task.archivedAt && (
										<span className="mt-1 block text-xs text-muted-foreground">
											{formatDateKeyLong(
												new Date(task.archivedAt).toISOString().slice(0, 10),
											)}
										</span>
									)}
								</TableCell>
								<TableCell className="text-right">
									{/* Built-ins have no actions at all: they can't be archived,
									    and they're on every project already so there's no project
									    list to manage. Archiving, never deleting: entries keep
									    pointing at the task, so the history stays readable. */}
									<RowActions
										actions={[
											// Built-ins are the site's, not the org's — the service
											// rejects editing them, so the action stays off menus
											// where it would only ever fail.
											!builtIn &&
												!task.archivedAt && {
													label: "Edit task",
													onClick: () => setEditTaskId(task.id),
												},
											!task.isAbsence &&
												!task.universal &&
												!task.archivedAt && {
													label: "Manage projects",
													onClick: () => setManageProjectsTaskId(task.id),
												},
											!builtIn &&
												!task.archivedAt && {
													label: "Archive",
													disabled: archiveMutation.isPending,
													onClick: () => archiveMutation.mutate(task.id),
												},
											// Restoring keeps the id, so the entries counted in this
											// row's Entries column come back attached to it. That's
											// the alternative to creating a same-named replacement,
											// which is how the archived pile grew in the first place.
											!builtIn &&
												task.archivedAt && {
													label: "Restore",
													disabled: unarchiveMutation.isPending,
													onClick: () => unarchiveMutation.mutate(task.id),
												},
										]}
									/>
								</TableCell>
							</TableRow>
						);
					})}
				</TableBody>
			</Table>

			<EditTaskDialog
				task={tasks.find((t) => t.id === editTaskId) ?? null}
				onOpenChange={(open) => !open && setEditTaskId(null)}
			/>

			<ManageTaskProjectsDialog
				taskId={manageProjectsTaskId}
				taskName={
					tasks.find((t) => t.id === manageProjectsTaskId)?.name ?? null
				}
				onOpenChange={(open) => !open && setManageProjectsTaskId(null)}
			/>
		</Page>
	);
}
