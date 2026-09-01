import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { CreateProjectDialog } from "#/components/create-project-dialog.tsx";
import {
	type ProjectCapabilities,
	ProjectDetailPanel,
} from "#/components/project-panel/project-detail-panel.tsx";
import { EmptyState } from "#/components/states/empty-state.tsx";
import { StatusPill } from "#/components/status-pill.tsx";
import {
	Avatar,
	AvatarFallback,
	AvatarGroup,
	AvatarGroupCount,
} from "#/components/ui/avatar.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import { PageFull, PageHeader } from "#/components/ui/page-header.tsx";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "#/components/ui/sheet.tsx";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table.tsx";
import { useMediaQuery } from "#/hooks/use-media-query.ts";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { resolveCategoryColor } from "#/lib/category-colors.ts";
import { formatHoursShort } from "#/lib/format-hours.ts";
import { cn, getInitials } from "#/lib/utils.ts";
import { clientsQuery } from "#/queries/clients.ts";
import { projectsQuery } from "#/queries/projects.ts";

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
	const { role } = Route.useRouteContext();
	const isAdmin = role === "owner" || role === "admin";
	const { data: projects } = useSuspenseQuery(projectsQuery(orgSlug));
	const { data: clients } = useSuspenseQuery(clientsQuery(orgSlug));
	const noClients = clients.length === 0;
	const [search, setSearch] = useState("");
	const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
	const [selectedId, setSelectedId] = useState<string | null>(null);
	// Below `lg` there is no rail to select INTO, so the same tap opens the panel
	// as a sheet instead. One flag rather than a second selection state: the sheet
	// is open exactly when a row was tapped and the rail isn't showing.
	const [sheetOpen, setSheetOpen] = useState(false);
	const hasRail = useMediaQuery("(min-width: 1024px)");

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
							title={
								isAdmin && noClients ? "No clients yet" : "No projects yet"
							}
							description={
								isAdmin
									? noClients
										? "Every project belongs to a client. Create a client first, then come back to add a project."
										: "Create your first project to start tracking time against it."
									: "No projects have been created yet."
							}
							action={
								isAdmin ? (
									noClients ? (
										<Button
											nativeButton={false}
											render={
												<Link
													to="/$orgSlug/settings/clients"
													params={{ orgSlug }}
												/>
											}
										>
											Go to Clients
										</Button>
									) : (
										<CreateProjectDialog />
									)
								) : undefined
							}
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
								const rowConfigurable = anyCapability(
									capabilitiesFor(project.myRole ?? null, isAdmin),
								);
								return (
									<TableRow
										key={project.id}
										className={cn(
											archived && "opacity-60",
											rowConfigurable && "cursor-pointer",
											hasRail &&
												selectedProject?.id === project.id &&
												"bg-[var(--sel)]",
										)}
										// A row only responds if the panel would have something on
										// it for this person. Without that a plain member gets a
										// pointer cursor and a tap that does nothing — the same
										// dead interaction the `lg`-only rail used to create for
										// everybody on a phone.
										onClick={
											rowConfigurable
												? () => {
														setSelectedId(project.id);
														if (!hasRail) setSheetOpen(true);
													}
												: undefined
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
									</TableRow>
								);
							})}
						</TableBody>
					</Table>
				)}
			</div>
		</div>
	);

	const capabilities = capabilitiesFor(
		selectedProject?.myRole ?? null,
		isAdmin,
	);
	const canConfigure = anyCapability(capabilities);

	const panel = (
		<ProjectDetailPanel
			project={selectedProject}
			orgSlug={orgSlug}
			capabilities={capabilities}
		/>
	);

	return (
		// Master/detail inside one island. Both panes used to pick their own cap
		// (narrow here, wide there), so the same route rendered at two different
		// widths depending on your role; the frame decides now, for both.
		//
		// One panel, two containers: the rail from `lg` up, a sheet below it. The
		// project's configuration used to be a row-actions menu of four modals,
		// which meant desktop and phone were two different products for the same
		// job — and left the row tap doing nothing at all under `lg`, since it only
		// ever fed a rail that wasn't rendered.
		<PageFull padded={false} className="flex-row">
			{main}
			{canConfigure && (
				<aside className="hidden w-80 shrink-0 flex-col border-l lg:flex xl:w-96 2xl:w-[28rem]">
					{panel}
				</aside>
			)}

			<Sheet
				open={sheetOpen && !hasRail && canConfigure}
				onOpenChange={setSheetOpen}
			>
				<SheetContent
					side="bottom"
					className="h-[85dvh] p-0 sm:max-w-none"
					showCloseButton
				>
					{/* Required by the dialog primitive for its accessible name, and
					    visually redundant with the panel's own header — the panel names
					    the project and the tabs say what you are looking at. */}
					<SheetHeader className="sr-only">
						<SheetTitle>{selectedProject?.name ?? "Project"}</SheetTitle>
						<SheetDescription>Configure this project</SheetDescription>
					</SheetHeader>
					{panel}
				</SheetContent>
			</Sheet>
		</PageFull>
	);
}

/**
 * What one person may do to one project — the same four questions the detail
 * panel's tabs are gated on, asked in one place so the row's tap target and the
 * panel's contents can never disagree about whether there is anything to open.
 *
 * A project role is per assignment (the same person is PM here and a plain
 * member there), which is why this takes the role rather than reading it.
 * Every one of these is re-checked by the service behind the write; this only
 * decides what is worth rendering.
 */
function capabilitiesFor(
	myRole: string | null,
	isAdmin: boolean,
): ProjectCapabilities {
	const leadOrAbove = isAdmin || myRole === "team_lead" || myRole === "pm";
	return {
		// projectsService.update / archive both assert canCloseProject.
		canEdit: isAdmin || myRole === "pm",
		canManageTasks: leadOrAbove,
		canManageMembers: leadOrAbove,
		// Linking repos is orgAdminMiddleware — an org role, not a project one.
		canManageRepos: isAdmin,
	};
}

const anyCapability = (c: ProjectCapabilities) =>
	c.canEdit || c.canManageTasks || c.canManageMembers || c.canManageRepos;

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
