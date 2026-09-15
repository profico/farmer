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
import { Switch } from "#/components/ui/switch.tsx";
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

// The projects list: one flat, sortable table, active first and archived folded
// away. Each row carries the project's icon, its client, its people, this
// month's hours against the busiest project's, and its all-time hours. A row is
// a link to the project's page for the people who have one (Team Lead and up on
// that project, and Admins); for a plain Member it is a row.
//
// Sorted by this month's hours, biggest first — "what is the company working
// on" is the question the list gets asked.
//
// **Grouping by client is a toggle now, and off by default.** It used to be the
// only mode, which fought the sort it was paired with: the rows said they were
// ordered by this month's hours, but the order only held inside a group, so the
// busiest project in the workspace could sit two thirds of the way down the
// page under a client heading. Twenty-one caps headings between sixty-seven
// rows also made the table read as headers all the way down. The client is a
// column instead, and the grouping is there for the reader who wants it.
//
// It replaced a master/detail — a list with a configuration rail beside it —
// which put a project's team and settings in a panel and its hours nowhere.

const MAX_AVATARS_SHOWN = 4;
const COLUMNS = 6;

type SortKey = "name" | "month";
type ProjectRow = { name: string; monthlyTotalSeconds: number };
const COMPARE = {
	name: byText((p: ProjectRow) => p.name),
	month: byNumber((p: ProjectRow) => p.monthlyTotalSeconds),
} satisfies Record<SortKey, (a: ProjectRow, b: ProjectRow) => number>;

const searchSchema = z.object({
	archived: searchFlag,
	/** Group the rows under their client. Off by default — see the note above.
	 *  In the URL rather than in state so a grouped list survives a reload and
	 *  can be linked to, which is what the guidelines ask of any stateful view. */
	group: searchFlag,
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
	const grouped = routeSearch.group === "1";
	const clientCount = new Set(projects.map((p) => p.clientId)).size;

	const counts = useMemo(
		() => ({
			active: projects.filter((p) => p.status === "active").length,
			archived: projects.filter((p) => p.status === "archived").length,
		}),
		[projects],
	);

	// The busiest project's month, which every row's bar is a share of. Taken
	// over the whole dataset rather than the filtered rows: a filter narrows
	// what somebody sees, not what a bar is measured against (CLAUDE.md, "Table
	// search … filters the view only").
	const busiestSeconds = Math.max(
		0,
		...projects.map((p) => p.monthlyTotalSeconds),
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
		// The code sits AFTER the name, as a chip. In front, bracketed and in
		// monospace, it was the loudest thing on every row and started each name
		// at a different x, so sixty-seven names could not be scanned down the
		// page (DESIGN.md, "Table heads and rows").
		const name = (
			<span className="flex items-center gap-2.5">
				<ProjectIcon
					icon={project.icon}
					name={project.name}
					size="sm"
					className="transition-transform duration-(--dur-base) group-hover/row:-translate-y-px"
				/>
				<span className="truncate">{project.name}</span>
				{project.code && (
					<span className="mono shrink-0 rounded-md bg-secondary px-1.5 py-0.5 text-2xs text-muted-foreground">
						{project.code}
					</span>
				)}
			</span>
		);
		const share =
			busiestSeconds > 0
				? Math.round((project.monthlyTotalSeconds / busiestSeconds) * 100)
				: 0;
		return (
			<TableRow
				key={project.id}
				className={cn(
					"group/row",
					isArchived && "opacity-60",
					opens && "cursor-pointer",
				)}
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
				<TableCell className="max-w-48 truncate text-muted-foreground">
					{project.client?.name ?? "—"}
				</TableCell>
				<TableCell>
					{project.statsScope === "own" ? (
						<span className="text-xs text-muted-foreground">
							Your time only
						</span>
					) : shown.length === 0 ? (
						<span className="text-sm text-muted-foreground">Nobody yet</span>
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
				{/* The figure, and beside it its share of the busiest project's month:
				    a column of numbers says who is biggest only after you have read
				    all of them, and a hairline bar says it at a glance. */}
				<TableCell className="text-right">
					<span className="inline-flex items-center justify-end gap-2.5">
						<span className="mono">
							{project.monthlyTotalSeconds > 0
								? formatReportHours(project.monthlyTotalSeconds)
								: "—"}
						</span>
						<span
							aria-hidden
							className="hidden h-1 w-16 overflow-hidden rounded-full bg-secondary sm:block"
						>
							<span
								className="rail-fill block h-full rounded-full bg-primary"
								style={{ width: `${share}%` }}
							/>
						</span>
					</span>
				</TableCell>
				<TableCell className="mono text-right text-muted-foreground">
					{formatReportHours(project.allTimeSeconds)}
				</TableCell>
				{/* Status only when it is not the default. "Active" on every one of
				    sixty-seven rows is a column of identical pills carrying no
				    information (DESIGN.md, "Table heads and rows"). */}
				<TableCell>
					{isArchived && <StatusPill tone="neutral">Archived</StatusPill>}
				</TableCell>
			</TableRow>
		);
	};

	return (
		<PageFull>
			<PageHeader
				title="Projects"
				lede={
					projects.length === 0
						? undefined
						: `${counts.active} active${counts.archived > 0 ? `, ${counts.archived} archived` : ""} across ${clientCount} ${clientCount === 1 ? "client" : "clients"}.`
				}
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

			{/* One line between the header and the table: what the rows are grouped
			    by on the left, how they are sorted on the right. Both are facts
			    about the table, so they sit on it rather than in the header. */}
			{projects.length > 0 && (
				<div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 pb-3">
					<label
						htmlFor="projects-group-by-client"
						className="flex cursor-pointer items-center gap-2.5 text-sm text-muted-foreground"
					>
						<Switch
							id="projects-group-by-client"
							size="sm"
							checked={grouped}
							onCheckedChange={(checked) =>
								navigate({
									to: "/$orgSlug/projects",
									params: { orgSlug },
									search: {
										...routeSearch,
										group: checked ? "1" : undefined,
									},
								})
							}
						/>
						Group by client
					</label>
					<span className="text-sm text-muted-foreground">
						Sorted by {sort.key === "name" ? "name" : "this month"},{" "}
						{sort.dir > 0
							? sort.key === "name"
								? "A to Z"
								: "smallest first"
							: sort.key === "name"
								? "Z to A"
								: "biggest first"}
					</span>
				</div>
			)}

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
								<TableHead>Client</TableHead>
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
							{active.length === 0 ? (
								<NoMatchesRow colSpan={COLUMNS}>
									No active projects match your search.
								</NoMatchesRow>
							) : grouped ? (
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
							) : (
								[...active].sort(compare).map(row)
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
