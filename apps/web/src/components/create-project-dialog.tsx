import { createProjectInput, type ProjectTypeValue } from "@farmer/core/schema";
import { zodResolver } from "@hookform/resolvers/zod";
import { PlusIcon } from "@phosphor-icons/react";
import {
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { ColorPicker } from "#/components/color-picker.tsx";
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
import { PillToggleGroup } from "#/components/ui/pill-toggle-group.tsx";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { CATEGORY_COLORS } from "#/lib/category-colors.ts";
import { clientsQuery } from "#/queries/clients.ts";
import { projectsQuery } from "#/queries/projects.ts";
import { selectableTasksQuery } from "#/queries/tasks.ts";
import { createProject } from "#/server/projects.ts";

const DEFAULT_COLOR = CATEGORY_COLORS[0].dot;

// The five project types, in the order the PRD lists them. Type is not
// cosmetic: it decides which config fields exist, whether the close sheet shows
// Expected hours, and whether the project counts as billable in Utilization.
const PROJECT_TYPES: {
	value: ProjectTypeValue;
	label: string;
	hint: string;
}[] = [
	{
		value: "product_team",
		label: "Product team",
		hint: "A standing team on a retainer. The only type whose close sheet shows Expected hours.",
	},
	{
		value: "fixed_scope",
		label: "Fixed scope",
		hint: "A bounded piece of work with an hour budget. The only type budget burn is computed for.",
	},
	{ value: "hourly", label: "Hourly", hint: "Billed by the hour as it goes." },
	{
		value: "maintenance",
		label: "Maintenance",
		hint: "Ongoing upkeep. No budget or price configuration in v1.",
	},
	{
		value: "internal",
		label: "Internal",
		hint: "Our own work. Never billed, and excluded from Utilization.",
	},
];

// The server's money fields are `regex(...).optional()`, which an EMPTY STRING
// fails — and the empty string is exactly what an untouched input holds. Since
// these inputs are only rendered for two of the five project types, that made
// every other type unsubmittable: zodResolver rejected a field the user could
// not see, so handleSubmit silently never fired. Accept "" explicitly here and
// let the mutation map it to undefined on the way out.
const optionalMoney = z.union([
	z.literal(""),
	z
		.string()
		.trim()
		.regex(/^\d+(\.\d{1,2})?$/, "Expected an amount like 1500 or 1500.00"),
]);

// Built from the individual field schemas (rather than .pick()) so the fields
// carrying zod defaults don't leak their z.infer/z.input mismatch into
// zodResolver — defaults are applied via the form's defaultValues instead.
const formSchema = z.object({
	name: createProjectInput.shape.name,
	code: createProjectInput.shape.code,
	color: createProjectInput.shape.color,
	clientId: createProjectInput.shape.clientId,
	type: createProjectInput.shape.type,
	budgetHours: z.union([
		z.literal(""),
		z
			.string()
			.trim()
			.regex(/^\d+(\.\d+)?$/, "Expected a number like 400 or 400.5")
			.refine((v) => {
				const n = Number(v);
				return n > 0 && n <= 100_000;
			}, "Must be between 1 and 100,000"),
	]),
	budgetAmount: optionalMoney,
	hourlyPrice: optionalMoney,
	taskIds: z.array(z.string()),
});

const EMPTY: z.infer<typeof formSchema> = {
	name: "",
	code: "",
	color: DEFAULT_COLOR,
	clientId: "",
	type: "product_team",
	budgetHours: "",
	budgetAmount: "",
	hourlyPrice: "",
	taskIds: [],
};

export function CreateProjectDialog() {
	const orgSlug = useOrgSlug();
	const [open, setOpen] = useState(false);
	const queryClient = useQueryClient();
	const { data: clients } = useSuspenseQuery(clientsQuery(orgSlug));
	const { data: allTasks } = useSuspenseQuery(selectableTasksQuery(orgSlug));
	const form = useForm<z.infer<typeof formSchema>>({
		resolver: zodResolver(formSchema),
		defaultValues: EMPTY,
	});

	const type = form.watch("type");
	const taskIds = form.watch("taskIds");
	// Neither universal shape is cherry-picked here. Absence tasks belong to
	// nobody's project — Vacation and Sick Leave are logged without one — and the
	// site built-ins (Meeting, Break) come with every project already, so offering
	// them as pills would imply you could create a project without them.
	const pickableTasks = allTasks.filter(
		(t) => !t.isAbsence && t.scope !== "site",
	);
	const builtInTasks = allTasks.filter(
		(t) => !t.isAbsence && t.scope === "site",
	);

	const toggleTask = (taskId: string) => {
		const current = form.getValues("taskIds");
		form.setValue(
			"taskIds",
			current.includes(taskId)
				? current.filter((id) => id !== taskId)
				: [...current, taskId],
		);
	};

	const mutation = useMutation({
		mutationFn: (data: z.infer<typeof formSchema>) =>
			createProject({
				data: {
					name: data.name,
					code: data.code || undefined,
					color: data.color,
					clientId: data.clientId,
					type: data.type,
					taskIds: data.taskIds,
					// Type-specific config: the server rejects a budget on a non-Fixed
					// Scope project, so clear the fields the current type doesn't own
					// rather than sending stale values from a type the user switched off.
					budgetHours:
						data.type === "fixed_scope"
							? data.budgetHours || undefined
							: undefined,
					budgetAmount:
						data.type === "fixed_scope"
							? data.budgetAmount || undefined
							: undefined,
					hourlyPrice:
						data.type === "hourly" ? data.hourlyPrice || undefined : undefined,
				},
			}),
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: projectsQuery(orgSlug).queryKey,
			});
			setOpen(false);
			form.reset(EMPTY);
		},
		onError: (error) => {
			toast.error(error.message ?? "Could not create project");
		},
	});

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger
				render={
					<Button>
						<PlusIcon weight="regular" />
						New project
					</Button>
				}
			/>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Create project</DialogTitle>
				</DialogHeader>
				<Form {...form}>
					<form
						onSubmit={form.handleSubmit((data) => mutation.mutate(data))}
						className="grid gap-4"
					>
						<div className="grid grid-cols-[1fr_auto] gap-4">
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
								name="code"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Code</FormLabel>
										<FormControl>
											<Input
												className="w-24"
												placeholder="ACME"
												{...field}
												value={field.value ?? ""}
											/>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
						</div>
						{/* Client is mandatory: every project belongs to one, and our own
						    work belongs to the org's internal client. */}
						<FormField
							control={form.control}
							name="clientId"
							render={({ field }) => (
								<FormItem>
									<FormLabel required>Client</FormLabel>
									<Select
										value={field.value}
										onValueChange={field.onChange}
										disabled={clients.length === 0}
										items={clients.map((c) => ({ value: c.id, label: c.name }))}
									>
										<FormControl>
											<SelectTrigger className="w-full">
												<SelectValue
													placeholder={
														clients.length === 0
															? "Create a client first"
															: "Pick a client"
													}
												/>
											</SelectTrigger>
										</FormControl>
										<SelectContent>
											{clients.map((c) => (
												<SelectItem key={c.id} value={c.id}>
													{c.name}
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
							name="type"
							render={({ field }) => (
								<FormItem>
									<FormLabel required>Type</FormLabel>
									<Select
										value={field.value}
										onValueChange={field.onChange}
										items={PROJECT_TYPES.map((t) => ({
											value: t.value,
											label: t.label,
										}))}
									>
										<FormControl>
											<SelectTrigger className="w-full">
												<SelectValue />
											</SelectTrigger>
										</FormControl>
										<SelectContent>
											{PROJECT_TYPES.map((t) => (
												<SelectItem key={t.value} value={t.value}>
													{t.label}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
									<p className="text-sm text-muted-foreground">
										{PROJECT_TYPES.find((t) => t.value === field.value)?.hint}
									</p>
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
											value={field.value}
											onChange={field.onChange}
										/>
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						{type === "fixed_scope" && (
							<div className="grid grid-cols-2 gap-4 border-t pt-3.5">
								<FormField
									control={form.control}
									name="budgetHours"
									render={({ field }) => (
										<FormItem>
											<FormLabel>Budget, hours</FormLabel>
											<FormControl>
												<Input
													inputMode="decimal"
													placeholder="e.g. 400"
													{...field}
													value={field.value ?? ""}
												/>
											</FormControl>
											<FormMessage />
										</FormItem>
									)}
								/>
								<FormField
									control={form.control}
									name="budgetAmount"
									render={({ field }) => (
										<FormItem>
											<FormLabel>Budget, amount</FormLabel>
											<FormControl>
												<Input
													inputMode="decimal"
													placeholder="e.g. 32000"
													{...field}
													value={field.value ?? ""}
												/>
											</FormControl>
											<p className="text-sm text-muted-foreground">
												Shown as context beside the hours. Nothing is computed
												from it.
											</p>
											<FormMessage />
										</FormItem>
									)}
								/>
							</div>
						)}
						{type === "hourly" && (
							<FormField
								control={form.control}
								name="hourlyPrice"
								render={({ field }) => (
									<FormItem className="border-t pt-3.5">
										<FormLabel>Hourly price</FormLabel>
										<FormControl>
											<Input
												inputMode="decimal"
												placeholder="e.g. 85"
												{...field}
												value={field.value ?? ""}
											/>
										</FormControl>
										<p className="text-sm text-muted-foreground">
											Visible to this project's PMs and admins only.
										</p>
										<FormMessage />
									</FormItem>
								)}
							/>
						)}
						{/* Tasks are a single global list; a project opts into the subset
						    that applies to it, which is what keeps cross-project reporting
						    comparable. */}
						<FormItem className="border-t pt-3.5">
							<FormLabel>Tasks on this project</FormLabel>
							<PillToggleGroup
								items={pickableTasks.map((t) => ({ id: t.id, label: t.name }))}
								selectedIds={taskIds}
								onToggle={toggleTask}
							/>
							<p className="text-sm text-muted-foreground">
								People can only log time against the tasks you pick here
								{builtInTasks.length > 0 && (
									<>
										, plus {builtInTasks.map((t) => t.name).join(" and ")},
										which every project gets
									</>
								)}
								. You can change the picks later from the project's Manage tasks
								action.
							</p>
						</FormItem>
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
