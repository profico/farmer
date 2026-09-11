import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { z } from "zod";

import { ArchivedSection } from "#/components/archived-section.tsx";
import { CreateProjectDialog } from "#/components/create-project-dialog.tsx";
import { PersonAvatar } from "#/components/person-avatar.tsx";
import {
	type ProjectCapabilities,
	ProjectDetailPanel,
} from "#/components/project-panel/project-detail-panel.tsx";
import { EmptyState } from "#/components/states/empty-state.tsx";
import { StatusPill } from "#/components/status-pill.tsx";
import { AvatarGroup, AvatarGroupCount } from "#/components/ui/avatar.tsx";
import { Button } from "#/components/ui/button.tsx";
import { PageFull, PageHeader } from "#/components/ui/page-header.tsx";
import { NoMatchesRow, SearchInput } from "#/components/ui/search-input.tsx";
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
import { matchesSearch } from "#/lib/search.ts";
import { cn } from "#/lib/utils.ts";
import { clientsQuery } from "#/queries/clients.ts";
import { projectsQuery } from "#/queries/projects.ts";

const MAX_AVATARS_SHOWN = 4;
const PROJECT_COLUMN_COUNT = 5;

const searchSchema = z.object({
	archived: z.literal("1").optional(),
});

export const Route = createFileRoute("/$orgSlug/projects/")({
	validateSearch: searchSchema,
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
	const [selectedId, setSelectedId] = useState<string | null>(null);
	// Below `lg` there is no rail to select INTO, so the same tap opens the panel
	// as a sheet instead. One flag rather than a second selection state: the sheet
	// is open exactly when a row was tapped and the rail isn't showing.
	const [sheetOpen, setSheetOpen] = useState(false);
	const hasRail = useMediaQuery("(min-width: 1024px)");
	const routeSearch = Route.useSearch();
	const navigate = Route.useNavigate();

	const counts = useMemo(
		() => ({
			active: projects.filter((p) => p.status === "active").length,
			archived: projects.filter((p) => p.status === "archived").length,
		}),
		[projects],
	);

	const searching = search.trim() !== "";
	const bothFiltered = useMemo(() => {
		const matches = (p: (typeof projects)[number]) =>
			matchesSearch(search, [p.name, p.client?.name]);
		return {
			active: projects.filter((p) => p.status === "active" && matches(p)),
			archived: projects.filter((p) => p.status === "archived" && matches(p)),
		};
	}, [projects, search]);
	const filteredActive = bothFiltered.active;
	const filteredArchived = bothFiltered.archived;

	// A search that only turns up archived rows would otherwise look like no
	// results at all — force the section open rather than hide the match.
	const archivedOpen =
		routeSearch.archived === "1" ||
		(searching && filteredActive.length === 0 && filteredArchived.length > 0);

	// The panel defaults to the first project until the user picks another; a
	// stale selectedId (e.g. after the project is archived away) also falls back.
	const selectedProject =
		(selectedId ? projects.find((p) => p.id === selectedId) : undefined) ??
		projects[0] ??
		null;

	const renderProjectRow = (project: (typeof projects)[number]) => {
		const category = resolveCategoryColor(project.color);
		const archived = project.status === "archived";
		const shownContributors = project.contributors.slice(0, MAX_AVATARS_SHOWN);
		const overflow = project.contributorCount - shownContributors.length;
		const rowConfigurable = anyCapability(
			capabilitiesFor(project.myRole ?? null, isAdmin),
		);
		return (
			<TableRow
				key={project.id}
				className={cn(
					archived && "opacity-60",
					rowConfigurable && "cursor-pointer",
					hasRail && selectedProject?.id === project.id && "bg-[var(--sel)]",
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
								<PersonAvatar
									key={c.id}
									userId={c.id}
									name={c.name}
									size="sm"
								/>
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
	};

	const main = (
		<div className="flex min-w-0 flex-1 flex-col p-4 sm:px-8 sm:py-8">
			<PageHeader
				// Every other screen's eyebrow says which slice you are looking at;
				// this one was an empty string, so Projects was the one page that
				// opened without saying what it was showing.
				eyebrow={`${counts.active} active · ${counts.archived} archived`}
				title="Projects"
				action={
					<div className="flex items-center gap-2">
						<SearchInput
							value={search}
							onValueChange={setSearch}
							placeholder="Search projects…"
							className="flex-1 sm:w-56 sm:flex-none"
						/>
						{isAdmin && <CreateProjectDialog />}
					</div>
				}
				className="shrink-0"
			/>

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
				) : filteredActive.length === 0 && filteredArchived.length === 0 ? (
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
							{filteredActive.length === 0 ? (
								<NoMatchesRow colSpan={PROJECT_COLUMN_COUNT}>
									No active projects match your search.
								</NoMatchesRow>
							) : (
								filteredActive.map(renderProjectRow)
							)}
							<ArchivedSection
								count={filteredArchived.length}
								colSpan={PROJECT_COLUMN_COUNT}
								open={archivedOpen}
								onOpenChange={(open) =>
									navigate({ search: { archived: open ? "1" : undefined } })
								}
							>
								{filteredArchived.map(renderProjectRow)}
							</ArchivedSection>
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
		// Master/detail inside one island. Both panes used to pick their own cap,
		// so the same route rendered at two different widths depending on your
		// role; the frame decides now, for both.
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
