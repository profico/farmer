import {
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { FolderKanban, MoreHorizontal, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CreateProjectDialog } from "#/components/create-project-dialog.tsx";
import { ManageProjectGithubReposDialog } from "#/components/manage-project-github-repos-dialog.tsx";
import { ProjectMembersPanel } from "#/components/project-members-panel.tsx";
import { EmptyState } from "#/components/states/empty-state.tsx";
import { StatusPill } from "#/components/status-pill.tsx";
import {
	Avatar,
	AvatarFallback,
	AvatarGroup,
	AvatarGroupCount,
} from "#/components/ui/avatar.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu.tsx";
import { Input } from "#/components/ui/input.tsx";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table.tsx";
import { resolveCategoryColor } from "#/lib/category-colors.ts";
import { formatHoursShort } from "#/lib/format-hours.ts";
import { cn, getInitials } from "#/lib/utils.ts";
import { clientsQuery } from "#/queries/clients.ts";
import { projectsQuery } from "#/queries/projects.ts";
import { archiveProject } from "#/server/projects.ts";

type StatusFilter = "all" | "active" | "archived";

const MAX_AVATARS_SHOWN = 4;

export const Route = createFileRoute("/$orgSlug/projects/")({
	loader: ({ context }) =>
		Promise.all([
			context.queryClient.ensureQueryData(projectsQuery()),
			context.queryClient.ensureQueryData(clientsQuery()),
		]),
	component: ProjectsPage,
});

function ProjectsPage() {
	const { organization, role } = Route.useRouteContext();
	const isAdmin = role === "owner" || role === "admin";
	const { data: projects } = useSuspenseQuery(projectsQuery());
	const queryClient = useQueryClient();
	const [search, setSearch] = useState("");
	const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
	const [manageReposProjectId, setManageReposProjectId] = useState<
		string | null
	>(null);
	const [selectedId, setSelectedId] = useState<string | null>(null);

	const archiveMutation = useMutation({
		mutationFn: (projectId: string) => archiveProject({ data: projectId }),
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: projectsQuery().queryKey,
			});
		},
		onError: (error) => {
			toast.error(error.message ?? "Could not archive project");
		},
	});

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
		<div className="flex min-w-0 flex-1 flex-col p-4 sm:p-8">
			<div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
				<h1 className="font-display text-xl">Projects</h1>
				<div className="flex items-center gap-2">
					<div className="relative flex-1 sm:flex-none">
						<Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
						<Input
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							placeholder="Search projects…"
							className="w-full pl-8 sm:w-56"
						/>
					</div>
					{isAdmin && <CreateProjectDialog />}
				</div>
			</div>

			{projects.length > 0 && (
				<div className="mt-5 flex shrink-0 items-center gap-1.5">
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

			<div className="-mx-4 mt-6 min-h-0 flex-1 overflow-y-auto sm:-mx-8">
				{projects.length === 0 ? (
					<div className="border-t border-b">
						<EmptyState
							icon={FolderKanban}
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
					<p className="mt-8 text-center text-sm text-muted-foreground">
						No projects match your search.
					</p>
				) : (
					<Table
						className="border-t [&_td:first-child]:pl-8 [&_td:last-child]:pr-8 [&_th:first-child]:pl-8 [&_th:last-child]:pr-8"
						containerClassName="border-b"
					>
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
												"bg-accent",
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
											<span className="font-display text-[15px]">
												{formatHoursShort(project.monthlyTotalSeconds)}
											</span>
										</TableCell>
										<TableCell>
											<StatusPill tone={archived ? "neutral" : "positive"}>
												{archived ? "Archived" : "Active"}
											</StatusPill>
										</TableCell>
										<TableCell onClick={(e) => e.stopPropagation()}>
											{!archived && (
												<DropdownMenu>
													<DropdownMenuTrigger
														render={
															<Button variant="ghost" size="icon-sm">
																<MoreHorizontal />
															</Button>
														}
													/>
													<DropdownMenuContent align="end">
														<DropdownMenuItem
															onClick={() =>
																setManageReposProjectId(project.id)
															}
														>
															Manage GitHub repos
														</DropdownMenuItem>
														<DropdownMenuItem
															onClick={() => archiveMutation.mutate(project.id)}
														>
															Archive
														</DropdownMenuItem>
													</DropdownMenuContent>
												</DropdownMenu>
											)}
										</TableCell>
									</TableRow>
								);
							})}
						</TableBody>
					</Table>
				)}
			</div>

			<ManageProjectGithubReposDialog
				projectId={manageReposProjectId}
				orgSlug={organization.slug}
				onOpenChange={(open) => !open && setManageReposProjectId(null)}
			/>
		</div>
	);

	if (!isAdmin) {
		return (
			<div className="flex h-[calc(100svh-var(--mobile-nav-h))] flex-col">
				{main}
			</div>
		);
	}

	return (
		<div className="flex h-[calc(100svh-var(--mobile-nav-h))]">
			{main}
			<aside className="hidden w-80 shrink-0 flex-col border-l lg:flex xl:w-96">
				<ProjectMembersPanel
					projectId={selectedProject?.id ?? null}
					projectName={selectedProject?.name ?? null}
				/>
			</aside>
		</div>
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
				"rounded-full border px-3 py-1 text-xs font-medium transition-colors",
				active
					? "border-primary bg-accent text-primary"
					: "border-border text-muted-foreground hover:bg-muted",
			)}
		>
			{label} {count}
		</button>
	);
}
