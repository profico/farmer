import { formatReportHours } from "@farmer/core/lib/report-format";
import { matchesSearch } from "@farmer/core/lib/search";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Fragment, useMemo, useState } from "react";
import { z } from "zod";

import { ArchivedSection } from "#/components/archived-section.tsx";
import { CreateProjectDialog } from "#/components/create-project-dialog.tsx";
import { PersonAvatar } from "#/components/person-avatar.tsx";
import { ProjectIcon } from "#/components/projects/project-icon.tsx";
import {
	byNumber,
	byText,
	type Sort,
	SortHead,
	toggleSort,
} from "#/components/reports/shared.tsx";
import { EmptyState } from "#/components/states/empty-state.tsx";
import { StatusPill } from "#/components/status-pill.tsx";
import { AvatarGroup, AvatarGroupCount } from "#/components/ui/avatar.tsx";
import { Button } from "#/components/ui/button.tsx";
import { PageFull, PageHeader } from "#/components/ui/page-header.tsx";
import { NoMatchesRow, SearchInput } from "#/components/ui/search-input.tsx";
import {
	stickyRowCellClass,
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
	TableScroll,
} from "#/components/ui/table.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { projectPageAccess } from "#/lib/project-access.ts";
import { searchFlag } from "#/lib/search-flag.ts";
import { cn } from "#/lib/utils.ts";
import { myAccessQuery } from "#/queries/access.ts";
import { clientsQuery } from "#/queries/clients.ts";
import { projectsQuery } from "#/queries/projects.ts";

// The projects list, as on Harvest: grouped by client, active first, archived
// folded away, the code as [CODE] before the name. Each row carries the
// project's icon, its people, this month's hours and its all-time hours. A row
// is a link to the project's page for the people who have one (Team Lead and
// up on that project, and Admins); for a plain Member it is a row.
//
// Sorted by this month's hours, biggest first — "what is the company working
// on" is the question the list gets asked — with the Project header as the
// alphabetical alternative. The client groups follow the same sort by their
// total, so the busiest client sits on top and its projects sort inside it.
//
// It replaced a master/detail — a list with a configuration rail beside it —
// which put a project's team and settings in a panel and its hours nowhere.

const MAX_AVATARS_SHOWN = 4;

const COLUMNS = 5;

type SortKey = "name" | "month";

type ProjectRow = { name: string; monthlyTotalSeconds: number };

const COMPARE = {
	name: byText((p: ProjectRow) => p.name),
	month: byNumber((p: ProjectRow) => p.monthlyTotalSeconds),
} satisfies Record<SortKey, (a: ProjectRow, b: ProjectRow) => number>;

const searchSchema = z.object({
	archived: searchFlag,
});

export const Route = createFileRoute("/$orgSlug/projects/")({
	validateSearch: searchSchema,
	loader: ({ context, params }) =>
		Promise.all([
			context.queryClient.ensureQueryData(projectsQuery(params.orgSlug)),
			context.queryClient.ensureQueryData(clientsQuery(params.orgSlug)),
			context.queryClient.ensureQueryData(myAccessQuery(params.orgSlug)),
		]),
	component: ProjectsPage,
});

function ProjectsPage() {
	const orgSlug = useOrgSlug();
	const { role } = Route.useRouteContext();
	const isAdmin = role === "owner" || role === "admin";
	const { data: projects } = useSuspenseQuery(projectsQuery(orgSlug));
	const { data: clients } = useSuspenseQuery(clientsQuery(orgSlug));
	const { data: me } = useSuspenseQuery(myAccessQuery(orgSlug));
	const noClients = clients.length === 0;
	const [search, setSearch] = useState("");
	const [sort, setSort] = useState<Sort<SortKey>>({ key: "month", dir: -1 });

	const onSort = (key: SortKey, numeric: boolean) =>
		setSort((current) => toggleSort(current, key, numeric));

	const compare = (a: ProjectRow, b: ProjectRow) =>
		COMPARE[sort.key](a, b) * sort.dir || a.name.localeCompare(b.name, "hr");

	const routeSearch = Route.useSearch();
	const navigate = useNavigate();

	const counts = useMemo(
		() => ({
			active: projects.filter((p) => p.status === "active").length,
			archived: projects.filter((p) => p.status === "archived").length,
		}),
		[projects],
	);

	const searching = search.trim() !== "";

	const matches = (p: (typeof projects)[number]) =>
		matchesSearch(search, [p.name, p.code, p.client?.name]);

	const active = projects.filter((p) => p.status === "active" && matches(p));

	const archived = projects.filter(
		(p) => p.status === "archived" && matches(p),
	);

	// Active projects under their client. By name: the internal client last —
	// the order the clients list keeps — and alphabetical within. By hours: the
	// groups by their month's total, the projects by theirs.
	const byClient = useMemo(() => {
		const groups = new Map<
			string,
			{
				name: string;
				internal: boolean;
				monthlyTotalSeconds: number;
				rows: typeof active;
			}
		>();

		for (const p of active) {
			const key = p.clientId;

			const g = groups.get(key) ?? {
				name: p.client?.name ?? "—",
				internal: p.client?.isInternal ?? false,
				monthlyTotalSeconds: 0,
				rows: [],
			};

			g.rows.push(p);
			g.monthlyTotalSeconds += p.monthlyTotalSeconds;
			groups.set(key, g);
		}

		return [...groups.values()]
			.sort((a, b) =>
				sort.key === "name"
					? Number(a.internal) - Number(b.internal) || compare(a, b)
					: compare(a, b),
			)
			.map((g) => ({ ...g, rows: g.rows.sort(compare) }));
		// oxlint-disable-next-line react-hooks/exhaustive-deps -- `compare` is a pure function of `sort`, which is listed
	}, [active, sort]);

	// A search that only turns up archived rows would otherwise look like no
	// results at all — force the section open rather than hide the match.
	const archivedOpen =
		routeSearch.archived === "1" ||
		(searching && active.length === 0 && archived.length > 0);

	const row = (project: (typeof projects)[number]) => {
		const isArchived = project.status === "archived";
		const shown = project.contributors.slice(0, MAX_AVATARS_SHOWN);
		const overflow = project.contributorCount - shown.length;
		const opens = projectPageAccess(isAdmin, project.myRole).canView;

		const name = (
			<span className="flex items-center gap-2.5">
				<ProjectIcon icon={project.icon} name={project.name} size="sm" />
				<span>
					{project.code && (
						<span className="mono mr-1.5 text-xs text-muted-foreground">
							[{project.code}]
						</span>
					)}
					{project.name}
				</span>
				{isArchived && (
					<span className="rounded-full bg-muted px-2 py-0.5 text-2xs text-muted-foreground">
						archived
					</span>
				)}
			</span>
		);

		return (
			<TableRow
				key={project.id}
				className={cn(isArchived && "opacity-60", opens && "cursor-pointer")}
				onClick={
					opens
						? () =>
								navigate({
									to: "/$orgSlug/projects/$projectId",
									params: { orgSlug, projectId: project.id },
								})
						: undefined
				}
			>
				<TableCell className="font-medium">
					{opens ? (
						<Link
							to="/$orgSlug/projects/$projectId"
							params={{ orgSlug, projectId: project.id }}
							onClick={(e) => e.stopPropagation()}
						>
							{name}
						</Link>
					) : (
						name
					)}
				</TableCell>
				<TableCell>
					{project.statsScope === "own" ? (
						<span className="text-xs text-muted-foreground">
							Your time only
						</span>
					) : shown.length === 0 ? (
						<span className="text-muted-foreground">—</span>
					) : (
						<AvatarGroup>
							{shown.map((c) => (
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
				<TableCell className="mono text-right">
					{formatReportHours(project.monthlyTotalSeconds)}
				</TableCell>
				<TableCell className="mono text-right text-muted-foreground">
					{formatReportHours(project.allTimeSeconds)}
				</TableCell>
				<TableCell>
					<StatusPill tone={isArchived ? "neutral" : "positive"}>
						{isArchived ? "Archived" : "Active"}
					</StatusPill>
				</TableCell>
			</TableRow>
		);
	};

	return (
		<PageFull>
			<PageHeader
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
						{me.canCreateProjects && <CreateProjectDialog />}
					</div>
				}
				className="shrink-0"
			/>

			<TableScroll>
				{projects.length === 0 ? (
					<div className="border-t border-b">
						<EmptyState
							title={
								me.canCreateProjects && noClients
									? "No clients yet"
									: "No projects yet"
							}
							description={
								me.canCreateProjects
									? noClients
										? "Every project belongs to a client. Create a client first, then come back to add a project."
										: "Create your first project to start tracking time against it."
									: "No projects have been created yet."
							}
							action={
								me.canCreateProjects ? (
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
				) : active.length === 0 && archived.length === 0 ? (
					<p className="border-t px-4 py-8 text-base text-muted-foreground sm:px-8">
						No projects match your search.
					</p>
				) : (
					<Table bleed={false} stickyHeader containerClassName="border-b">
						<TableHeader>
							<TableRow>
								<SortHead
									label="Project"
									sortKey="name"
									sort={sort}
									onSort={onSort}
								/>
								<TableHead>Team</TableHead>
								<SortHead
									label="This month"
									sortKey="month"
									numeric
									sort={sort}
									onSort={onSort}
									className="text-right"
								/>
								<TableHead className="text-right">All-time</TableHead>
								<TableHead>Status</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{byClient.length === 0 ? (
								<NoMatchesRow colSpan={COLUMNS}>
									No active projects match your search.
								</NoMatchesRow>
							) : (
								byClient.map((group) => (
									<Fragment key={group.name}>
										<TableRow className="hover:bg-transparent">
											<TableCell
												colSpan={COLUMNS}
												className={cn(
													"border-b-0 pt-5 pb-1",
													stickyRowCellClass,
												)}
											>
												<span className="eyebrow">{group.name}</span>
											</TableCell>
										</TableRow>
										{group.rows.map(row)}
									</Fragment>
								))
							)}
							<ArchivedSection
								count={archived.length}
								colSpan={COLUMNS}
								open={archivedOpen}
								sticky
								onOpenChange={(open) =>
									navigate({
										to: "/$orgSlug/projects",
										params: { orgSlug },
										search: { archived: open ? "1" : undefined },
									})
								}
							>
								{[...archived].sort(compare).map(row)}
							</ArchivedSection>
						</TableBody>
					</Table>
				)}
			</TableScroll>
		</PageFull>
	);
}
