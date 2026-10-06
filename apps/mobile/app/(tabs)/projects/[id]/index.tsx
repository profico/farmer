import type { ProjectDetail } from "@farmer/api-client";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Platform, View } from "react-native";

import { useAccess } from "../../../../src/api/capabilities";
import {
	useProject,
	useProjectMembers,
	useProjectOverview,
} from "../../../../src/api/projects";
import { useProjects, useTimer } from "../../../../src/api/queries";
import { projectPageAccess, roleLabel } from "../../../../src/projects/access";
import { ProjectMark } from "../../../../src/projects/components/project-mark";
import { projectTitle, typeLabel } from "../../../../src/projects/model";
import {
	ReportControls,
	usePeriodState,
	useRange,
} from "../../../../src/reports/components/controls";
import { EntriesDrilldown } from "../../../../src/reports/components/drilldown";
import { StatTiles } from "../../../../src/reports/components/figure";
import {
	formatCount,
	formatReportHours,
	plural,
} from "../../../../src/reports/format";
import { dayLabel } from "../../../../src/reports/period";
import {
	ActionButton,
	EmptyState,
	ErrorState,
	Skeleton,
	Text,
} from "../../../../src/ui/components";
import { Inset, Screen } from "../../../../src/ui/screen";
import {
	SettingsLink,
	SettingsSection,
} from "../../../../src/ui/settings-list";
import { usePalette } from "../../../../src/ui/theme";
import { SPACE } from "../../../../src/ui/type";

/** "Log time" and "Start timer here", for a person who may log time on
 *  the project. */
function TimeActions({ projectId }: { projectId: string }) {
	const palette = usePalette();
	const router = useRouter();
	const timer = useTimer();
	const running = timer.data?.timer ?? null;
	return (
		<>
			<View style={{ flexDirection: "row", gap: SPACE.s, flexWrap: "wrap" }}>
				<ActionButton
					label="Log time"
					onPress={() =>
						router.push({ pathname: "/entry", params: { projectId } })
					}
				/>
				<ActionButton
					label="Start timer here"
					variant="outlined"
					disabled={running !== null}
					onPress={() =>
						router.push({ pathname: "/start-timer", params: { projectId } })
					}
				/>
			</View>
			{running ? (
				<Text variant="bodySmall" color={palette.onSurfaceVariant}>
					A timer is already running. Stop it before you start another.
				</Text>
			) : null}
		</>
	);
}

/** The whole history of the project in four figures, whatever period the
 *  entries below show. */
function Overview({ projectId }: { projectId: string }) {
	const overview = useProjectOverview(projectId, true);
	if (overview.isError) {
		return (
			<ErrorState
				error={overview.error}
				onRetry={() => void overview.refetch()}
			/>
		);
	}
	const data = overview.data;
	return (
		<StatTiles
			tiles={[
				{
					label: "All-time hours",
					value: data ? formatReportHours(data.allTimeSeconds) : null,
					caption: data
						? `${plural(data.entryCount, "entry", "entries")}, ${formatCount(data.peopleCount)} ${data.peopleCount === 1 ? "person" : "people"} ever`
						: undefined,
				},
				{
					label: "This month",
					value: data ? formatReportHours(data.monthSeconds) : null,
					caption: data
						? `${plural(data.monthPeople, "person", "people")} logged`
						: undefined,
				},
				{
					label: "First entry",
					value: data
						? data.firstEntry
							? dayLabel(data.firstEntry)
							: "-"
						: null,
					caption: data
						? data.lastEntry
							? `last ${dayLabel(data.lastEntry)}`
							: "nothing logged yet"
						: undefined,
				},
				{
					label: "Overtime",
					value: data ? formatReportHours(data.overtimeSeconds) : null,
					caption: data ? "all-time, flagged" : undefined,
				},
			]}
		/>
	);
}

/** The entries of the team for a period, in groups. */
function ProjectEntries({ project }: { project: ProjectDetail }) {
	const period = usePeriodState();
	const range = useRange(period.selection);
	const members = useProjectMembers(project.id, true);
	const roleOf = members.data
		? (userId: string) => {
				const member = members.data.find(
					(row) => row.userId === userId && row.active,
				);
				return member ? roleLabel(member.role) : null;
			}
		: undefined;
	return (
		<>
			<ReportControls period={period} />
			{range ? (
				<EntriesDrilldown
					filters={{ ...range, projectId: project.id }}
					groups={["teammate", "task", "date"]}
					initialBy="teammate"
					exportName={`${project.code ?? project.name}_${range.from}_${range.to}`}
					roleOf={roleOf}
					empty="Nothing logged in this period."
				/>
			) : (
				<Inset>
					<Skeleton height={120} />
				</Inset>
			)}
		</>
	);
}

/** The project from the list of API version 1, with no figures: only the
 *  ways to log time. */
function PlainProject({ id }: { id: string }) {
	const palette = usePalette();
	const projects = useProjects();
	if (projects.isPending) {
		return (
			<Screen topInset={false}>
				<Inset>
					<Skeleton height={64} />
				</Inset>
			</Screen>
		);
	}
	if (projects.isError) {
		return (
			<Screen topInset={false}>
				<ErrorState
					error={projects.error}
					onRetry={() => void projects.refetch()}
				/>
			</Screen>
		);
	}
	const project = projects.data.find((row) => row.id === id);
	if (!project) {
		return (
			<Screen topInset={false}>
				<EmptyState
					icon="folder"
					title="Project not found"
					message="You may no longer be on this project."
				/>
			</Screen>
		);
	}
	return (
		<>
			<Stack.Screen options={{ title: project.name }} />
			<Screen topInset={false}>
				<Inset>
					<Text variant="labelLarge" color={palette.onSurfaceVariant}>
						{project.client.name}
					</Text>
					<Text variant="headlineSmall">{projectTitle(project)}</Text>
					<TimeActions projectId={project.id} />
				</Inset>
			</Screen>
		</>
	);
}

/**
 * A project's page, as on the web: the mark, the name and what it is; the
 * whole history in four figures; then the entries of a period, in groups
 * by teammate. Team and Settings are screens of their own. A plain member
 * sees no figures of the team, and the page says so.
 */
export default function ProjectScreen() {
	const palette = usePalette();
	const router = useRouter();
	const { id } = useLocalSearchParams<{ id: string }>();
	const access = useAccess();
	const { project, ...list } = useProject(id);

	if (!access.fullApi) return <PlainProject id={id} />;
	if (list.isPending) {
		return (
			<Screen topInset={false}>
				<Inset>
					<Skeleton height={72} />
					<Skeleton height={56} />
					<Skeleton height={160} />
				</Inset>
			</Screen>
		);
	}
	if (list.isError) {
		return (
			<Screen topInset={false}>
				<ErrorState error={list.error} onRetry={() => void list.refetch()} />
			</Screen>
		);
	}
	if (!project) {
		return (
			<Screen topInset={false}>
				<EmptyState
					icon="folder"
					title="Project not found"
					message="You may no longer be on this project."
				/>
			</Screen>
		);
	}

	const page = projectPageAccess(
		access.isAdmin,
		project.role,
		project.openToOrg,
	);
	const archived = project.status === "archived";
	const facts = [
		project.client.name,
		typeLabel(project.type),
		archived ? "Archived" : "Active",
		page.canView
			? plural(project.stats.contributorCount, "person", "people")
			: null,
	].filter((part) => part !== null);

	return (
		<>
			{/* On iOS the header shows the full title and the page does not
			    repeat it. */}
			<Stack.Screen
				options={{
					title: Platform.OS === "ios" ? projectTitle(project) : project.name,
				}}
			/>
			<Screen
				topInset={false}
				refreshing={list.isRefetching}
				onRefresh={() => void list.refetch()}
			>
				<Inset>
					<View
						style={{ flexDirection: "row", gap: SPACE.l, alignItems: "center" }}
					>
						<ProjectMark icon={project.icon} name={project.name} size="large" />
						<View style={{ flex: 1 }}>
							{Platform.OS === "ios" ? null : (
								<Text variant="headlineSmall">{projectTitle(project)}</Text>
							)}
							<Text variant="bodyMedium" color={palette.onSurfaceVariant}>
								{facts.join(", ")}
							</Text>
							{project.role ? (
								<Text variant="bodySmall" color={palette.onSurfaceVariant}>
									{`You: ${roleLabel(project.role)}`}
								</Text>
							) : null}
						</View>
					</View>
					{page.canLogTime && !archived ? (
						<TimeActions projectId={project.id} />
					) : null}
				</Inset>
				{page.canManageTeam || page.canManageSettings ? (
					<SettingsSection title="Manage">
						{page.canManageTeam ? (
							<SettingsLink
								icon="team"
								tint="blue"
								title="Team"
								subtitle="Who may log time here, and who runs the project"
								onPress={() =>
									router.push({
										pathname: "/projects/[id]/team",
										params: { id: project.id },
									})
								}
							/>
						) : null}
						{page.canManageSettings ? (
							<SettingsLink
								icon="settings"
								tint="gray"
								title="Settings"
								subtitle="Name, code, client, type, icon and archive"
								onPress={() =>
									router.push({
										pathname: "/projects/[id]/settings",
										params: { id: project.id },
									})
								}
							/>
						) : null}
					</SettingsSection>
				) : null}
				{page.canView ? (
					<>
						<Inset>
							<Overview projectId={project.id} />
						</Inset>
						<ProjectEntries project={project} />
					</>
				) : (
					<Inset>
						<Text variant="bodyMedium" color={palette.onSurfaceVariant}>
							{`You are on ${project.name} as a member. Its page, with the entries of everyone and the team, is for the project's team leads and PMs. Your own time on it is on your timesheet and in your reports.`}
						</Text>
					</Inset>
				)}
			</Screen>
		</>
	);
}
