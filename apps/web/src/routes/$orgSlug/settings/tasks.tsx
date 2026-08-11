import { createTaskInput } from "@farmer/core/schema";
import { zodResolver } from "@hookform/resolvers/zod";
import {
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";
import { ColorPicker } from "#/components/color-picker.tsx";
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
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table.tsx";
import {
	CATEGORY_COLORS,
	resolveCategoryColor,
} from "#/lib/category-colors.ts";
import { managedTasksQuery } from "#/queries/tasks.ts";
import { requireOrgAdmin } from "#/server/auth.ts";
import { archiveTask, createTask } from "#/server/tasks.ts";

export const Route = createFileRoute("/$orgSlug/settings/tasks")({
	beforeLoad: async () => {
		await requireOrgAdmin();
	},
	loader: async ({ context }) => {
		await context.queryClient.ensureQueryData(managedTasksQuery());
	},
	component: TasksPage,
});

const DEFAULT_COLOR = CATEGORY_COLORS[0].dot;

function CreateTaskDialog() {
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
				queryKey: managedTasksQuery().queryKey,
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
						className="grid gap-4"
					>
						<FormField
							control={form.control}
							name="name"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Name</FormLabel>
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

function TasksPage() {
	const queryClient = useQueryClient();
	const { data: tasks } = useSuspenseQuery(managedTasksQuery());

	const archiveMutation = useMutation({
		mutationFn: (taskId: string) => archiveTask({ data: taskId }),
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: managedTasksQuery().queryKey,
			});
		},
		onError: (error) => toast.error(error.message ?? "Could not archive task"),
	});

	return (
		<Page className="screen">
			<PageHeader
				eyebrow="Workspace"
				title="Tasks"
				lede={`One global list for the whole company. Projects pick the subset that applies to them, which is what keeps a "Development" hour on one project comparable to a "Development" hour on another. Vacation and Sick Leave are built in and can't be changed.`}
				action={<CreateTaskDialog />}
				className="mb-0"
			/>

			<Table containerClassName="mt-6">
				<TableHeader>
					<TableRow>
						<TableHead>Task</TableHead>
						<TableHead>Kind</TableHead>
						<TableHead className="text-right">Entries</TableHead>
						<TableHead>Status</TableHead>
						<TableHead />
					</TableRow>
				</TableHeader>
				<TableBody>
					{tasks.map((task) => {
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
								<TableCell className="mono text-right">
									{task.entryCount}
								</TableCell>
								<TableCell>
									<StatusPill tone={task.archivedAt ? "neutral" : "positive"}>
										{task.archivedAt ? "Archived" : "Active"}
									</StatusPill>
								</TableCell>
								<TableCell className="text-right">
									{/* Archiving, never deleting: entries keep pointing at the
										    task, so the history stays readable. */}
									{!builtIn && !task.archivedAt && (
										<Button
											variant="ghost"
											size="sm"
											disabled={archiveMutation.isPending}
											onClick={() => archiveMutation.mutate(task.id)}
										>
											Archive
										</Button>
									)}
								</TableCell>
							</TableRow>
						);
					})}
				</TableBody>
			</Table>
		</Page>
	);
}
