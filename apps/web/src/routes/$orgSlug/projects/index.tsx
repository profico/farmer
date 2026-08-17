import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import {
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CreateProjectDialog } from "#/components/create-project-dialog.tsx";
import { EditProjectDialog } from "#/components/edit-project-dialog.tsx";
import { ManageProjectGithubReposDialog } from "#/components/manage-project-github-repos-dialog.tsx";
import { ManageProjectTasksDialog } from "#/components/manage-project-tasks-dialog.tsx";
import { ProjectMembersPanel } from "#/components/project-members-panel.tsx";
import { EmptyState } from "#/components/states/empty-state.tsx";
import { StatusPill } from "#/components/status-pill.tsx";
import {
	Avatar,
	AvatarFallback,
	AvatarGroup,
	AvatarGroupCount,
} from "#/components/ui/avatar.tsx";
import { Input } from "#/components/ui/input.tsx";
import { PageFull, PageHeader } from "#/components/ui/page-header.tsx";
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
import { resolveCategoryColor } from "#/lib/category-colors.ts";
import { formatHoursShort } from "#/lib/format-hours.ts";
import { cn, getInitials } from "#/lib/utils.ts";
import { clientsQuery } from "#/queries/clients.ts";
import { projectsQuery } from "#/queries/projects.ts";
import { archiveProject, unarchiveProject } from "#/server/projects.ts";

type StatusFilter = "all" | "active" | "archived";

const MAX_AVATARS_SHOWN = 4;

export const Route = createFileRoute("/$orgSlug/projects/")({
	loader: ({ context, params }) =>
		Promise.all([
			context.queryClient.ensureQueryData(projectsQuery(params.orgSlug)),
			context.queryClient.ensureQueryData(clientsQuery(params.orgSlug)),
		]),
	component: ProjectsPage,
});

function ProjectsPage() {
	const orgSlug = useOrgSlug();
	const { organization, role } = Route.useRouteContext();
	const isAdmin = role === "owner" || role === "admin";
	const { data: projects } = useSuspenseQuery(projectsQuery(orgSlug));
	const queryClient = useQueryClient();
	const [search, setSearch] = useState("");
	const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
	const [manageReposProjectId, setManageReposProjectId] = useState<
		string | null
	>(null);
	const [manageTasksProjectId, setManageTasksProjectId] = useState<
		string | null
	>(null);
	const [editProjectId, setEditProjectId] = useState<string | null>(null);
	const [selectedId, setSelectedId] = useState<string | null>(null);

	const invalidateProjects = () =>
		queryClient.invalidateQueries({
			queryKey: projectsQuery(orgSlug).queryKey,
		});

	const archiveMutation = useMutation({
		mutationFn: (projectId: string) => archiveProject({ data: projectId }),
		onSuccess: invalidateProjects,
		onError: (error) => {
			toast.error(error.message ?? "Could not archive project");
		},
	});

	const unarchiveMutation = useMutation({
		mutationFn: (projectId: string) => unarchiveProject({ data: projectId }),
		onSuccess: invalidateProjects,
		onError: (error) => {
			toast.error(error.message ?? "Could not restore project");
		},
	});

	const busy = archiveMutation.isPending || unarchiveMutation.isPending;

	const counts = useMemo(
		() => ({
			all: projects.length,
			active: projects.filter((p) => p.status === "active").length,
			archived: projects.filter((p) => p.status === "archived").length,
		}),
		[projects],
	);

	const filtered = useMemo(() => {
		const query = search.trim().toLowerCase();
		return projects.filter((p) => {
			if (statusFilter !== "all" && p.status !== statusFilter) return false;
			if (!query) return true;
			return (
				p.name.toLowerCase().includes(query) ||
				(p.client?.name.toLowerCase().includes(query) ?? false)
			);
		});
	}, [projects, search, statusFilter]);

	// The panel defaults to the first project until the user picks another; a
	// stale selectedId (e.g. after the project is archived away) also falls back.
	const selectedProject =
		(selectedId ? projects.find((p) => p.id === selectedId) : undefined) ??
		projects[0] ??
		null;

	const main = (
		<div className="flex min-w-0 flex-1 flex-col p-4 sm:px-8 sm:py-8">
			<PageHeader
				eyebrow={``}
				title="Projects"
				action={
					<div className="flex items-center gap-2">
						<div className="relative flex-1 sm:flex-none">
							<MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" />
							<Input
								value={search}
								onChange={(e) => setSearch(e.target.value)}
								placeholder="Search projects…"
								className="w-full pl-8 sm:w-56"
							/>
						</div>
						{isAdmin && <CreateProjectDialog />}
					</div>
				}
				className="mb-0 shrink-0"
			/>

			{projects.length > 0 && (
				<div className="mt-6 flex shrink-0 items-center gap-1.5">
					<FilterPill
						label="All"
						count={counts.all}
						active={statusFilter === "all"}
						onClick={() => setStatusFilter("all")}
					/>
					<FilterPill
						label="Active"
						count={counts.active}
						active={statusFilter === "active"}
						onClick={() => setStatusFilter("active")}
					/>
					<FilterPill
						label="Archived"
						count={counts.archived}
						active={statusFilter === "archived"}
						onClick={() => setStatusFilter("archived")}
					/>
				</div>
			)}

			{/* This scroller already bleeds to the island edge, so the table inside
			    it takes gutters only — bleeding twice would pull it clean out. */}
			<div className="-mx-4 mt-6 min-h-0 flex-1 overflow-y-auto sm:-mx-8">
				{projects.length === 0 ? (
					<div className="border-t border-b">
						<EmptyState
							title="No projects yet"
							description={
								isAdmin
									? "Create your first project to start tracking time against it."
									: "No projects have been created yet."
							}
							action={isAdmin ? <CreateProjectDialog /> : undefined}
						/>
					</div>
				) : filtered.length === 0 ? (
					<p className="border-t px-4 py-8 text-base text-muted-foreground sm:px-8">
						No projects match your search.
					</p>
				) : (
					<Table bleed={false} containerClassName="border-y">
						<TableHeader>
							<TableRow>
								<TableHead>Project</TableHead>
								<TableHead>Client</TableHead>
								<TableHead>Team</TableHead>
								<TableHead>This month</TableHead>
								<TableHead>Status</TableHead>
								<TableHead />
							</TableRow>
						</TableHeader>
						<TableBody>
							{filtered.map((project) => {
								const category = resolveCategoryColor(project.color);
								const archived = project.status === "archived";
								// Editing the task subset is the same capability as editing the
								// team — Team Lead and up, which the service enforces anyway;
								// this just keeps the action off menus where it would only ever
								// fail.
								const canManageTasks =
									isAdmin ||
									project.myRole === "team_lead" ||
									project.myRole === "pm";
								// Editing the project's own record is PM territory, the same
								// bar projectsService.update enforces.
								const canEdit = isAdmin || project.myRole === "pm";
								const shownContributors = project.contributors.slice(
									0,
									MAX_AVATARS_SHOWN,
								);
								const overflow =
									project.contributorCount - shownContributors.length;
								return (
									<TableRow
										key={project.id}
										className={cn(
											archived && "opacity-60",
											isAdmin && "cursor-pointer",
											isAdmin &&
												selectedProject?.id === project.id &&
												"bg-[var(--sel)]",
										)}
										onClick={
											isAdmin ? () => setSelectedId(project.id) : undefined
										}
									>
										<TableCell className="font-medium">
											<span className="flex items-center gap-2">
												<span
													className="size-2 shrink-0 rounded-full"
													style={{ backgroundColor: category.dot }}
												/>
												{project.name}
											</span>
										</TableCell>
										<TableCell className="text-muted-foreground">
											{project.client?.name ?? "—"}
										</TableCell>
										<TableCell>
											{shownContributors.length === 0 ? (
												<span className="text-muted-foreground">—</span>
											) : (
												<AvatarGroup>
													{shownContributors.map((c) => (
														<Avatar key={c.id} size="sm">
															<AvatarFallback>
																{getInitials(c.name)}
															</AvatarFallback>
														</Avatar>
													))}
													{overflow > 0 && (
														<AvatarGroupCount className="size-6 text-xs">
															+{overflow}
														</AvatarGroupCount>
													)}
												</AvatarGroup>
											)}
										</TableCell>
										<TableCell>
											<span className="mono text-sm">
												{formatHoursShort(project.monthlyTotalSeconds)}
											</span>
										</TableCell>
										<TableCell>
											<StatusPill tone={archived ? "neutral" : "positive"}>
												{archived ? "Archived" : "Active"}
											</StatusPill>
										</TableCell>
										<TableCell onClick={(e) => e.stopPropagation()}>
											{/* An archived project is dormant, not gone — the only
											    thing you can do to it is bring it back, and RowActions
											    renders a lone action as its own button, not a menu. */}
											<RowActions
												actions={[
													!archived &&
														canEdit && {
															label: "Edit project",
															onClick: () => setEditProjectId(project.id),
														},
													!archived &&
														canManageTasks && {
															label: "Manage tasks",
															onClick: () =>
																setManageTasksProjectId(project.id),
														},
													!archived && {
														label: "Manage GitHub repos",
														onClick: () => setManageReposProjectId(project.id),
													},
													archived
														? {
																label: "Restore",
																disabled: busy,
																onClick: () =>
																	unarchiveMutation.mutate(project.id),
															}
														: {
																label: "Archive",
																disabled: busy,
																onClick: () =>
																	archiveMutation.mutate(project.id),
															},
												]}
											/>
										</TableCell>
									</TableRow>
								);
							})}
						</TableBody>
					</Table>
				)}
			</div>

			<EditProjectDialog
				project={projects.find((p) => p.id === editProjectId) ?? null}
				onOpenChange={(open) => !open && setEditProjectId(null)}
			/>

			<ManageProjectGithubReposDialog
				projectId={manageReposProjectId}
				orgSlug={organization.slug}
				onOpenChange={(open) => !open && setManageReposProjectId(null)}
			/>

			<ManageProjectTasksDialog
				projectId={manageTasksProjectId}
				projectName={
					projects.find((p) => p.id === manageTasksProjectId)?.name ?? null
				}
				onOpenChange={(open) => !open && setManageTasksProjectId(null)}
			/>
		</div>
	);

	if (!isAdmin) {
		return (
			// No detail panel for non-admins — the table is the whole island.
			<PageFull padded={false} className="flex-col">
				{main}
			</PageFull>
		);
	}

	return (
		// Master/detail inside one island. Both panes used to pick their own cap
		// (narrow here, wide there), so the same route rendered at two different
		// widths depending on your role; the frame decides now, for both.
		<PageFull padded={false} className="flex-row">
			{main}
			<aside className="hidden w-80 shrink-0 flex-col border-l lg:flex xl:w-96 2xl:w-[28rem]">
				<ProjectMembersPanel
					projectId={selectedProject?.id ?? null}
					projectName={selectedProject?.name ?? null}
				/>
			</aside>
		</PageFull>
	);
}

function FilterPill({
	label,
	count,
	active,
	onClick,
}: {
	label: string;
	count: number;
	active: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"rounded-full border px-3 py-1 text-xs transition-colors duration-(--dur-fast)",
				active
					? "border-primary/40 bg-primary/8 font-medium text-primary"
					: "border-border text-muted-foreground hover:bg-muted",
			)}
		>
			{label} {count}
		</button>
	);
}
