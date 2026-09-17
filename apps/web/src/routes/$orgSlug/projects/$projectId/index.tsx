import { formatReportHours } from "@farmer/core/lib/report-format";
import { resolveReportPeriod } from "@farmer/core/lib/report-period";
import { dayKeyInTz } from "@farmer/core/lib/time";
import type { TimeReportDetailInput } from "@farmer/core/schema";
import { ArrowLeftIcon } from "@phosphor-icons/react";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Suspense } from "react";
import { z } from "zod";

import { ProjectIcon } from "#/components/projects/project-icon.tsx";
import {
	EntriesDrilldown,
	EntriesExport,
	EntriesFigure,
	type EntryGroup,
} from "#/components/reports/entries-drilldown.tsx";
import { periodSearch } from "#/components/reports/search.ts";
import { FigurePending, PeriodPicker } from "#/components/reports/shared.tsx";
import { StatusPill } from "#/components/status-pill.tsx";
import { AddBlockDialog } from "#/components/time/add-block-dialog.tsx";
import { returnLinkClass } from "#/components/time/time-toolbar.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Page, PageHeader } from "#/components/ui/page-header.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { StatTile, StatTiles } from "#/components/ui/stat-tile.tsx";
import { formatDateKeyLong } from "#/lib/format-date.ts";
import { projectPageAccess } from "#/lib/project-access.ts";
import { myAccessQuery } from "#/queries/access.ts";
import {
	projectMembersQuery,
	projectOverviewQuery,
	projectQuery,
} from "#/queries/projects.ts";

// A project's page (Sept 2026), the way the COO signed it off: the icon, the
// name and what it is; the whole of its history in four numbers; then its
// entries for a period — the Reports drill-down, already narrowed to this
// project, grouped by teammate unless asked otherwise. Team and Settings are
// pages of their own, behind the two buttons at the right.
//
// For Team Leads and PMs of the project, and Admins. A plain Member sees
// nothing at project level (§4), which the services enforce and this page
// says out loud rather than erroring.

const PROJECT_GROUPS = ["teammate", "task", "date"] as const;

const searchSchema = z.object({
	...periodSearch,
	by: z.enum(PROJECT_GROUPS).optional(),
});

export const Route = createFileRoute("/$orgSlug/projects/$projectId/")({
	validateSearch: searchSchema,
	loader: ({ context, params }) =>
		Promise.all([
			context.queryClient.ensureQueryData(
				projectQuery(params.orgSlug, params.projectId),
			),
			context.queryClient.ensureQueryData(myAccessQuery(params.orgSlug)),
		]),
	component: ProjectPage,
});

const TYPE_LABEL = {
	product_team: "Product team",
	fixed_scope: "Fixed scope",
	hourly: "Hourly",
	maintenance: "Maintenance",
	internal: "Internal",
} as const;

const ROLE_LABEL = {
	member: "Member",
	team_lead: "Team Lead",
	pm: "PM",
} as const;

function ProjectPage() {
	const { organization, role } = Route.useRouteContext();
	const { projectId } = Route.useParams();
	const search = Route.useSearch();
	const navigate = Route.useNavigate();
	const orgSlug = organization.slug;
	const isAdmin = role === "owner" || role === "admin";
	const { data: project } = useSuspenseQuery(projectQuery(orgSlug, projectId));
	const access = projectPageAccess(isAdmin, project.myRole, project.openToOrg);

	const today = dayKeyInTz(new Date(), organization.timezone);
	const thisMonth = today.slice(0, 7);

	const { from, to } = resolveReportPeriod(
		search,
		today,
		organization.weekStartsOn,
	);

	const by: EntryGroup = search.by ?? "teammate";
	const input: TimeReportDetailInput = { from, to, projectId };
	const archived = project.status === "archived";

	// The roster tags each person's row with their role — read without
	// suspending, so the table never waits on it.
	const members = useQuery({
		...projectMembersQuery(orgSlug, projectId),
		enabled: access.canView,
	}).data;

	const roleOf = members
		? (userId: string) => {
				const m = members.find((r) => r.userId === userId && r.active);

				return m ? ROLE_LABEL[m.role] : null;
			}
		: undefined;

	const teamSize = project.contributorCount;

	return (
		<Page>
			<PageHeader
				eyebrow={
					<Link
						to="/$orgSlug/projects"
						params={{ orgSlug }}
						className={`${returnLinkClass} inline-flex items-center gap-1`}
					>
						<ArrowLeftIcon weight="regular" className="size-3.5" />
						Projects
					</Link>
				}
				title={
					<span className="flex items-center gap-3">
						<ProjectIcon icon={project.icon} name={project.name} />
						<span className="min-w-0">
							{project.code && (
								<span className="mono mr-2 text-xl text-muted-foreground">
									[{project.code}]
								</span>
							)}
							{project.name}
						</span>
					</span>
				}
				lede={
					<span className="flex flex-wrap items-center gap-x-2 gap-y-1">
						<span>{project.client?.name ?? "—"}</span>
						<span aria-hidden>·</span>
						<span>{TYPE_LABEL[project.type]}</span>
						<span aria-hidden>·</span>
						<StatusPill tone={archived ? "neutral" : "positive"}>
							{archived ? "Archived" : "Active"}
						</StatusPill>
						{access.canView && (
							<>
								<span aria-hidden>·</span>
								<span>
									{teamSize} {teamSize === 1 ? "person" : "people"}
								</span>
							</>
						)}
					</span>
				}
				action={
					<div className="flex items-center gap-2">
						{access.canManageTeam && (
							<Button
								variant="outline"
								nativeButton={false}
								render={
									<Link
										to="/$orgSlug/projects/$projectId/team"
										params={{ orgSlug, projectId }}
									/>
								}
							>
								Team
							</Button>
						)}
						{access.canManageSettings && (
							<Button
								variant="outline"
								nativeButton={false}
								render={
									<Link
										to="/$orgSlug/projects/$projectId/settings"
										params={{ orgSlug, projectId }}
									/>
								}
							>
								Settings
							</Button>
						)}
						{access.canLogTime && !archived && (
							<AddBlockDialog
								timezone={organization.timezone}
								defaultDate={today}
								defaultProjectId={projectId}
								trigger={<Button>Log time</Button>}
							/>
						)}
					</div>
				}
			/>

			{!access.canView ? (
				<p className="max-w-[62ch] text-base text-muted-foreground">
					You're on {project.name} as a member. Its page — everyone's entries
					and the team — is for the project's team leads and PMs. Your own time
					on it is on your timesheet and in your reports.
				</p>
			) : (
				<>
					<Suspense fallback={<StripPending />}>
						<OverviewStrip orgSlug={orgSlug} projectId={projectId} />
					</Suspense>

					<div className="mt-6">
						<PeriodPicker
							search={search}
							today={today}
							thisMonth={thisMonth}
							link={(s) => (
								<Link
									to="/$orgSlug/projects/$projectId"
									params={{ orgSlug, projectId }}
									search={s}
								/>
							)}
							navigateTo={(s) =>
								navigate({
									to: "/$orgSlug/projects/$projectId",
									params: { orgSlug, projectId },
									search: s,
								})
							}
						>
							<Suspense fallback={<FigurePending label="Total hours" />}>
								<EntriesFigure input={input} />
							</Suspense>
							<Suspense
								fallback={
									<Button variant="outline" size="sm" disabled>
										Export
									</Button>
								}
							>
								<EntriesExport
									input={input}
									by={by}
									filename={`${project.code ?? project.name}_${from}_${to}`}
									title="Detailed time report"
									facts={[
										[
											"Project",
											`${project.code ? `[${project.code}] ` : ""}${project.name}`,
										],
										["Client", project.client?.name ?? "—"],
									]}
								/>
							</Suspense>
						</PeriodPicker>
					</div>

					<EntriesDrilldown
						input={input}
						groups={PROJECT_GROUPS}
						by={by}
						onByChange={(next) =>
							navigate({
								to: "/$orgSlug/projects/$projectId",
								params: { orgSlug, projectId },
								search: { ...search, by: next },
							})
						}
						roleOf={roleOf}
						empty="Nothing logged in this period."
					/>

					<p className="mt-3 max-w-[72ch] text-sm text-muted-foreground">
						{by === "teammate"
							? "Open a name for their entries. Hours sorts the people; any other column sorts the entries inside."
							: by === "task"
								? "Open a task for its entries."
								: "Open a day for its entries."}{" "}
						Roles are edited on the Team page.
					</p>
				</>
			)}
		</Page>
	);
}

/** The whole of the project's history in four numbers, whatever period the
 *  table below is set to. The home page's band, four cells wide: same
 *  hairlines, same bleed to the island's edge, same figures. None of the four
 *  is a fraction of a target, so none of them carries a meter. */
function OverviewStrip({
	orgSlug,
	projectId,
}: {
	orgSlug: string;
	projectId: string;
}) {
	const { data } = useSuspenseQuery(projectOverviewQuery(orgSlug, projectId));

	return (
		<StatTiles columns={4}>
			<StatTile
				label="All-time hours"
				value={formatReportHours(data.allTimeSeconds)}
				caption={
					<>
						{data.entryCount.toLocaleString("hr-HR")}{" "}
						{data.entryCount === 1 ? "entry" : "entries"} · {data.peopleCount}{" "}
						{data.peopleCount === 1 ? "person" : "people"} ever
					</>
				}
			/>
			<StatTile
				label="This month"
				value={formatReportHours(data.monthSeconds)}
				caption={`${data.monthPeople} ${data.monthPeople === 1 ? "person" : "people"} logged`}
			/>
			{/* The one cell that is a date rather than a measurement, so it keeps the
			    body face the rest of the app sets dates in. */}
			<StatTile
				label="First entry"
				value={
					<span className="font-sans tracking-normal">
						{data.firstEntry ? formatDateKeyLong(data.firstEntry) : "—"}
					</span>
				}
				caption={
					data.lastEntry
						? `last ${formatDateKeyLong(data.lastEntry)}`
						: "nothing logged yet"
				}
			/>
			<StatTile
				label="Overtime"
				value={formatReportHours(data.overtimeSeconds)}
				caption="all-time, flagged"
			/>
		</StatTiles>
	);
}

function StripPending() {
	return (
		<StatTiles columns={4}>
			{["All-time hours", "This month", "First entry", "Overtime"].map((l) => (
				<StatTile key={l} label={l} value={<Skeleton className="h-6 w-24" />} />
			))}
		</StatTiles>
	);
}

export { TYPE_LABEL as PROJECT_TYPE_LABEL };
