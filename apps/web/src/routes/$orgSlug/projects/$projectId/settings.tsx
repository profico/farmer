import { isUploadedFile } from "@farmer/core/lib/uploads";
import {
	projectTypeEnum,
	type ProjectTypeValue,
	type UpdateProjectInput,
} from "@farmer/core/schema";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeftIcon } from "@phosphor-icons/react";
import {
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { ProjectGithubRepos } from "#/components/projects/project-github-repos.tsx";
import { ProjectIconPicker } from "#/components/projects/project-icon-picker.tsx";
import { ProjectIcon } from "#/components/projects/project-icon.tsx";
import { returnLinkClass } from "#/components/time/time-toolbar.tsx";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "#/components/ui/alert-dialog.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "#/components/ui/form.tsx";
import { InputGroup, InputGroupInput } from "#/components/ui/input-group.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Page, PageHeader, PageSection } from "#/components/ui/page-header.tsx";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select.tsx";
import { projectPageAccess } from "#/lib/project-access.ts";
import { clientsQuery } from "#/queries/clients.ts";
import {
	myProjectsQuery,
	projectQuery,
	projectsQuery,
} from "#/queries/projects.ts";
import {
	archiveProject,
	unarchiveProject,
	updateProject,
} from "#/server/projects.ts";

// A project's settings: what it is called and how it looks, in one scrolling
// page. Nothing saves until Save — the bar appears the moment something
// changes and goes away when it is saved or discarded — except Archive, which
// asks first and acts at once. PM and Admin (`canManageProject`); a Team Lead
// here holds the project as a PM does.

const PROJECT_TYPES: {
	value: ProjectTypeValue;
	label: string;
	hint: string;
}[] = [
	{
		value: "product_team",
		label: "Product team",
		hint: "A standing team on a retainer.",
	},
	{
		value: "fixed_scope",
		label: "Fixed scope",
		hint: "A bounded piece of work.",
	},
	{ value: "hourly", label: "Hourly", hint: "Billed by the hour as it goes." },
	{ value: "maintenance", label: "Maintenance", hint: "Ongoing upkeep." },
	{ value: "internal", label: "Internal", hint: "Our own work. Never billed." },
];

// Mirrors create-project-dialog.tsx: the server's money fields are
// `regex(...).optional()`, which an empty string fails, and the empty string
// is what an untouched — or type-hidden — input holds. Accept "" here and let
// the mutation map it to undefined on the way out.
const optionalMoney = z.union([
	z.literal(""),
	z
		.string()
		.trim()
		.regex(/^\d+(\.\d{1,2})?$/, "Must be an amount"),
]);

// Name and client restate core's rules in the form's own words, as
// create-project-dialog.tsx does: the error sits inside the box, beside its
// label, where "Required" is all it needs to say.
const formSchema = z.object({
	name: z.string().trim().min(1, "Required").max(120),
	code: z.string().trim().max(16),
	clientId: z.uuid("Required"),
	type: projectTypeEnum,
	icon: z.string().nullable(),
	budgetHours: z.union([
		z.literal(""),
		z
			.string()
			.trim()
			.regex(/^\d+(\.\d+)?$/, "Must be an amount")
			.refine((v) => {
				const n = Number(v);
				return n > 0 && n <= 100_000;
			}, "Must be 1 to 100,000"),
	]),
	budgetAmount: optionalMoney,
	hourlyPrice: optionalMoney,
});
type FormValues = z.infer<typeof formSchema>;

// The boxes stop at the schema's limits, so "too long" is never the error.
const NAME_MAX_LENGTH = formSchema.shape.name.maxLength ?? undefined;
const CODE_MAX_LENGTH = formSchema.shape.code.maxLength ?? undefined;

export const Route = createFileRoute("/$orgSlug/projects/$projectId/settings")({
	loader: ({ context, params }) =>
		Promise.all([
			context.queryClient.ensureQueryData(
				projectQuery(params.orgSlug, params.projectId),
			),
			context.queryClient.ensureQueryData(clientsQuery(params.orgSlug)),
		]),
	component: SettingsPage,
});

function SettingsPage() {
	const { organization, role } = Route.useRouteContext();
	const { projectId } = Route.useParams();
	const orgSlug = organization.slug;
	const isAdmin = role === "owner" || role === "admin";
	const queryClient = useQueryClient();
	const { data: project } = useSuspenseQuery(projectQuery(orgSlug, projectId));
	const { data: projects } = useSuspenseQuery(projectsQuery(orgSlug));
	const { data: clients } = useSuspenseQuery(clientsQuery(orgSlug));
	const access = projectPageAccess(isAdmin, project.myRole);
	const archived = project.status === "archived";

	const form = useForm<FormValues>({
		resolver: zodResolver(formSchema),
		defaultValues: {
			name: project.name,
			code: project.code ?? "",
			clientId: project.clientId,
			type: project.type,
			icon: project.icon,
			budgetHours:
				project.budgetSeconds != null
					? String(project.budgetSeconds / 3600)
					: "",
			budgetAmount: project.budgetAmount ?? "",
			hourlyPrice: project.hourlyPrice ?? "",
		},
	});
	const nameNow = form.watch("name");
	const typeNow = form.watch("type");

	const refresh = () =>
		Promise.all([
			queryClient.invalidateQueries({
				queryKey: projectQuery(orgSlug, projectId).queryKey,
			}),
			queryClient.invalidateQueries({
				queryKey: projectsQuery(orgSlug).queryKey,
			}),
			queryClient.invalidateQueries({
				queryKey: myProjectsQuery(orgSlug).queryKey,
			}),
		]);

	const save = useMutation({
		mutationFn: (values: FormValues) => {
			// A patch of what changed, and only that: sending `type` resets the
			// type-specific budget fields, which a rename has no business doing.
			const dirty = form.formState.dirtyFields;
			const patch: UpdateProjectInput = { projectId };
			if (dirty.name) patch.name = values.name;
			if (dirty.code) patch.code = values.code;
			if (dirty.clientId) patch.clientId = values.clientId;
			if (dirty.icon) patch.icon = values.icon;
			// Type-specific config moves together with type, matching the create
			// dialog: the server rejects a budget or price sent without its type
			// (`updateProjectInput`'s refinement), and sending `type` alone nulls
			// out the money fields it doesn't hear about (`update` in
			// projects.service.ts). So a caller who only edits the budget still
			// carries the current type along, and a caller who only changes the
			// type carries the money they just typed for it.
			if (
				dirty.type ||
				dirty.budgetHours ||
				dirty.budgetAmount ||
				dirty.hourlyPrice
			) {
				patch.type = values.type;
				patch.budgetHours =
					values.type === "fixed_scope" && values.budgetHours
						? Number(values.budgetHours)
						: undefined;
				patch.budgetAmount =
					values.type === "fixed_scope"
						? values.budgetAmount || undefined
						: undefined;
				patch.hourlyPrice =
					values.type === "hourly"
						? values.hourlyPrice || undefined
						: undefined;
			}
			return updateProject({ data: patch });
		},
		onSuccess: async (_saved, values) => {
			await refresh();
			// Re-baseline to what was just saved, so the bar goes away.
			form.reset(values);
			toast.success("Project saved");
		},
		onError: (error) =>
			toast.error(error.message ?? "Could not save the project"),
	});

	const status = useMutation({
		mutationFn: () =>
			archived
				? unarchiveProject({ data: projectId })
				: archiveProject({ data: projectId }),
		onSuccess: async () => {
			await refresh();
			toast.success(
				archived
					? `${project.name} restored`
					: `${project.name} archived — it stays in every report`,
			);
		},
		onError: (error) =>
			toast.error(error.message ?? "Could not change the project's status"),
	});

	const back = (
		<Link
			to="/$orgSlug/projects/$projectId"
			params={{ orgSlug, projectId }}
			className={`${returnLinkClass} inline-flex items-center gap-1`}
		>
			<ArrowLeftIcon weight="regular" className="size-3.5" />
			{project.name}
		</Link>
	);
	const title = (
		<span className="flex items-center gap-3">
			<ProjectIcon icon={project.icon} name={project.name} size="sm" />
			Settings
		</span>
	);

	if (!access.canManageSettings) {
		return (
			<Page>
				<PageHeader eyebrow={back} title={title} />
				<p className="max-w-[62ch] text-base text-muted-foreground">
					The settings are managed by the project's PMs.
				</p>
			</Page>
		);
	}

	const recentIcons = projects
		.map((p) => p.icon)
		.filter((i): i is string => i != null);
	const dirty = form.formState.isDirty;

	return (
		<Page>
			<PageHeader eyebrow={back} title={title} />
			<Form {...form}>
				<form onSubmit={form.handleSubmit((values) => save.mutate(values))}>
					<PageSection
						title="Icon"
						description="How the project looks in the list, on its page, in the picker and on the timesheet."
					>
						<FormField
							control={form.control}
							name="icon"
							render={({ field }) => (
								<FormItem>
									<div className="flex items-center gap-4">
										<ProjectIcon
											icon={field.value}
											name={nameNow || project.name}
											size="lg"
										/>
										<div>
											<ProjectIconPicker
												value={field.value}
												onChange={field.onChange}
												recent={recentIcons}
												trigger={
													<Button type="button" variant="outline">
														{field.value ? "Change icon…" : "Choose an icon…"}
													</Button>
												}
											/>
											<p className="mt-1.5 text-xs text-muted-foreground">
												{isUploadedFile(field.value)
													? "An uploaded image."
													: field.value
														? "An emoji."
														: "No icon — the first letter of the name."}
											</p>
										</div>
									</div>
									<FormMessage />
								</FormItem>
							)}
						/>
					</PageSection>

					<PageSection
						title="Details"
						description="The name and code appear as [CODE] Name everywhere."
					>
						<div className="grid max-w-2xl gap-4">
							<div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
								<FormField
									control={form.control}
									name="name"
									render={({ field }) => (
										<FormItem>
											<FormLabel required>Name</FormLabel>
											<InputGroup>
												<FormControl>
													<InputGroupInput
														maxLength={NAME_MAX_LENGTH}
														{...field}
													/>
												</FormControl>
												<FormMessage />
											</InputGroup>
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
													className="mono"
													placeholder="VINW"
													maxLength={CODE_MAX_LENGTH}
													{...field}
												/>
											</FormControl>
											<FormMessage />
										</FormItem>
									)}
								/>
							</div>
							<div className="grid items-start gap-4 sm:grid-cols-2">
								<FormField
									control={form.control}
									name="clientId"
									render={({ field }) => (
										<FormItem>
											<FormLabel required>Client</FormLabel>
											<Select
												value={field.value}
												onValueChange={field.onChange}
												items={clients.map((c) => ({
													value: c.id,
													label: c.name,
												}))}
											>
												<FormControl>
													<SelectTrigger className="w-full">
														<SelectValue />
														<FormMessage aria-hidden />
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
												{
													PROJECT_TYPES.find((t) => t.value === field.value)
														?.hint
												}
											</p>
											<FormMessage />
										</FormItem>
									)}
								/>
							</div>
							{typeNow === "fixed_scope" && (
								<div className="grid grid-cols-2 gap-4 border-t pt-3.5">
									<FormField
										control={form.control}
										name="budgetHours"
										render={({ field }) => (
											<FormItem>
												<FormLabel>Budget, hours</FormLabel>
												<InputGroup>
													<FormControl>
														<InputGroupInput
															inputMode="decimal"
															placeholder="e.g. 400"
															{...field}
															value={field.value ?? ""}
														/>
													</FormControl>
													<FormMessage />
												</InputGroup>
											</FormItem>
										)}
									/>
									<FormField
										control={form.control}
										name="budgetAmount"
										render={({ field }) => (
											<FormItem>
												<FormLabel>Budget, amount</FormLabel>
												<InputGroup>
													<FormControl>
														<InputGroupInput
															inputMode="decimal"
															placeholder="e.g. 32000"
															{...field}
															value={field.value ?? ""}
														/>
													</FormControl>
													<FormMessage />
												</InputGroup>
												<p className="text-sm text-muted-foreground">
													Shown as context beside the hours. Nothing is computed
													from it.
												</p>
											</FormItem>
										)}
									/>
								</div>
							)}
							{typeNow === "hourly" && (
								<FormField
									control={form.control}
									name="hourlyPrice"
									render={({ field }) => (
										<FormItem className="border-t pt-3.5">
											<FormLabel>Hourly price</FormLabel>
											<InputGroup>
												<FormControl>
													<InputGroupInput
														inputMode="decimal"
														placeholder="e.g. 85"
														{...field}
														value={field.value ?? ""}
													/>
												</FormControl>
												<FormMessage />
											</InputGroup>
											<p className="text-sm text-muted-foreground">
												Visible to this project's PMs and admins only.
											</p>
										</FormItem>
									)}
								/>
							)}
						</div>
					</PageSection>

					{isAdmin && (
						<PageSection
							title="GitHub repositories"
							description="Commits on a linked repository attach to the day's entry on this project."
						>
							<ProjectGithubRepos
								projectId={projectId}
								projectName={project.name}
								orgSlug={orgSlug}
								className="max-w-2xl"
							/>
						</PageSection>
					)}

					<PageSection
						title={archived ? "Restore" : "Archive"}
						description={
							archived
								? "Restoring puts the project back in the pickers and in “Active projects only”."
								: "Archiving hides the project from the pickers and from “Active projects only”. Nothing is deleted; its history stays in every report, and it can be restored at any time."
						}
					>
						<AlertDialog>
							<AlertDialogTrigger
								render={
									<Button
										type="button"
										variant="outline"
										className={archived ? undefined : "hover:text-destructive"}
										disabled={status.isPending}
									/>
								}
							>
								{archived ? "Restore project" : "Archive project…"}
							</AlertDialogTrigger>
							<AlertDialogContent>
								<AlertDialogHeader>
									<AlertDialogTitle>
										{archived
											? `Restore ${project.name}?`
											: `Archive ${project.name}?`}
									</AlertDialogTitle>
									<AlertDialogDescription>
										{archived
											? "People assigned to it can log time on it again."
											: "Nobody can log more time on it until it is restored. Everything already logged stays where it is."}
									</AlertDialogDescription>
								</AlertDialogHeader>
								<AlertDialogFooter>
									<AlertDialogCancel>Cancel</AlertDialogCancel>
									<AlertDialogAction
										variant={archived ? "default" : "destructive"}
										onClick={() => status.mutate()}
									>
										{archived ? "Restore" : "Archive"}
									</AlertDialogAction>
								</AlertDialogFooter>
							</AlertDialogContent>
						</AlertDialog>
					</PageSection>

					{dirty && (
						<div className="sticky bottom-4 mt-7 flex max-w-2xl items-center gap-3 rounded-lg border bg-background px-4 py-3 shadow-[var(--shadow-pop)]">
							<span className="mr-auto text-sm text-muted-foreground">
								Unsaved changes
							</span>
							<Button
								type="button"
								variant="ghost"
								onClick={() => form.reset()}
								disabled={save.isPending}
							>
								Discard
							</Button>
							<Button type="submit" disabled={save.isPending}>
								{save.isPending ? "Saving…" : "Save changes"}
							</Button>
						</div>
					)}
				</form>
			</Form>
		</Page>
	);
}
