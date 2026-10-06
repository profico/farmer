import type { Project, ProjectDetail } from "@farmer/api-client";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Platform, View } from "react-native";

import { useAccess } from "../../../src/api/capabilities";
import {
	useArchiveProject,
	useActiveClients,
	useProjectList,
} from "../../../src/api/projects";
import { useProjects } from "../../../src/api/queries";
import { HeaderActions } from "../../../src/navigation/header-actions";
import { projectPageAccess } from "../../../src/projects/access";
import { ProjectMark } from "../../../src/projects/components/project-mark";
import { ProjectRow } from "../../../src/projects/components/project-row";
import { useConfirmProjectStatus } from "../../../src/projects/confirm-status";
import {
	groupByClient,
	PROJECT_SORTS,
	type ProjectSort,
	projectMatches,
	projectTitle,
	sortProjects,
} from "../../../src/projects/model";
import {
	ListCard,
	Note,
	SummaryRow,
} from "../../../src/reports/components/disclosure";
import {
	ActionButton,
	EmptyState,
	ErrorState,
	IconButton,
	ListRow,
	SectionHeader,
	Skeleton,
} from "../../../src/ui/components";
import { showDialog } from "../../../src/ui/dialog";
import { messageOf } from "../../../src/ui/errors";
import { Icon } from "../../../src/ui/icon";
import { ListSearch } from "../../../src/ui/list-search";
import { Inset, Screen } from "../../../src/ui/screen";
import { SegmentedControl } from "../../../src/ui/segmented";
import { usePalette } from "../../../src/ui/theme";

function Loading() {
	return (
		<Inset>
			<Skeleton height={64} />
			<Skeleton height={64} />
			<Skeleton height={64} />
		</Inset>
	);
}

/** A Server before API version 2 sends the projects without figures: the
 *  plain list by client. */
function PlainList({ search }: { search: string }) {
	const palette = usePalette();
	const router = useRouter();
	const projects = useProjects();
	if (projects.isPending) return <Loading />;
	if (projects.isError) {
		return (
			<ErrorState
				error={projects.error}
				onRetry={() => void projects.refetch()}
			/>
		);
	}
	const needle = search.trim().toLowerCase();
	const shown = projects.data.filter(
		(project: Project) =>
			!needle ||
			[project.name, project.code ?? "", project.client.name].some((text) =>
				text.toLowerCase().includes(needle),
			),
	);
	if (shown.length === 0) {
		return (
			<EmptyState
				icon="folder"
				title="No projects"
				message="You are not on a project in this workspace yet."
			/>
		);
	}
	const groups = new Map<string, Project[]>();
	for (const project of shown) {
		groups.set(project.client.name, [
			...(groups.get(project.client.name) ?? []),
			project,
		]);
	}
	return [...groups.entries()]
		.sort(([a], [b]) => a.localeCompare(b, "hr"))
		.map(([client, members]) => (
			<View key={client}>
				<SectionHeader>{client}</SectionHeader>
				<ListCard>
					{members.map((project) => (
						<ListRow
							key={project.id}
							leading={
								<ProjectMark icon={project.icon ?? null} name={project.name} />
							}
							title={projectTitle(project)}
							onPress={() =>
								router.push({
									pathname: "/projects/[id]",
									params: { id: project.id },
								})
							}
							trailing={
								<Icon
									name="forward"
									size={20}
									color={palette.onSurfaceVariant}
								/>
							}
						/>
					))}
				</ListCard>
			</View>
		));
}

/**
 * The projects, as on the web: active ones by client, with this month's
 * hours, and the archived ones folded under them. By hours, the busiest
 * client and project are first. A person with the right to create a
 * project has the add button.
 */
export default function ProjectsScreen() {
	const router = useRouter();
	const access = useAccess();
	const list = useProjectList();
	const clients = useActiveClients(access.canManageProjects);
	const archive = useArchiveProject();
	const status = useConfirmProjectStatus();
	const [search, setSearch] = useState("");
	const [sort, setSort] = useState<ProjectSort>("month");
	const [archivedOpen, setArchivedOpen] = useState(false);

	const openProject = (project: ProjectDetail) =>
		router.push({ pathname: "/projects/[id]", params: { id: project.id } });

	// Settings and Archive or Restore, for a person who manages the project.
	const actionsFor = (project: ProjectDetail) =>
		projectPageAccess(access.isAdmin, project.role).canManageSettings
			? [
					{
						label: "Settings",
						icon: "settings",
						onPress: () =>
							router.push({
								pathname: "/projects/[id]/settings",
								params: { id: project.id },
							}),
					} as const,
					project.status === "archived"
						? ({
								label: "Restore",
								icon: "restore",
								onPress: () => status.confirm(project),
							} as const)
						: ({
								label: "Archive",
								icon: "archive",
								destructive: true,
								onPress: () => status.confirm(project),
							} as const),
				]
			: [];

	const restore = (project: ProjectDetail) =>
		showDialog(
			`Restore ${project.name}?`,
			"People assigned to it can log time on it again.",
			[
				{ text: "Cancel", style: "cancel" },
				{
					text: "Restore",
					onPress: () =>
						archive.mutate(
							{ id: project.id, archive: false },
							{
								onError: (error) =>
									showDialog(
										"Could not restore the project",
										messageOf(error) ?? "",
									),
							},
						),
				},
			],
		);

	const all = list.data ?? [];
	const counts = {
		active: all.filter((project) => project.status === "active").length,
		archived: all.filter((project) => project.status === "archived").length,
	};

	const body = () => {
		if (!access.fullApi) return <PlainList search={search} />;
		if (list.isPending) return <Loading />;
		if (list.isError) {
			return (
				<ErrorState error={list.error} onRetry={() => void list.refetch()} />
			);
		}
		if (all.length === 0) {
			const noClients =
				access.canManageProjects && clients.data !== undefined
					? clients.data.length === 0
					: false;
			return (
				<EmptyState
					icon="folder"
					title={noClients ? "No clients yet" : "No projects yet"}
					message={
						access.canManageProjects
							? noClients
								? "Every project belongs to a client. Create a client first, then come back to add a project."
								: "Create your first project to start tracking time against it."
							: // A member sees only the projects they are on and the
								// projects open to the whole organization.
								"You are not on a project yet. Ask an admin or a project manager to add you to one."
					}
					action={
						access.canManageProjects ? (
							noClients ? (
								<ActionButton
									label="Go to Clients"
									onPress={() => router.push("/workspace/clients")}
								/>
							) : (
								<ActionButton
									label="New project"
									onPress={() => router.push("/projects/new")}
								/>
							)
						) : undefined
					}
				/>
			);
		}

		const active = all.filter(
			(project) =>
				project.status === "active" && projectMatches(project, search),
		);
		const archived = sortProjects(
			all.filter(
				(project) =>
					project.status === "archived" && projectMatches(project, search),
			),
			sort,
		);
		// A search that finds only archived projects opens their section, so
		// the match does not look like no result.
		const showArchived =
			archivedOpen ||
			(search.trim() !== "" && active.length === 0 && archived.length > 0);
		const groups = groupByClient(active, sort);

		if (active.length === 0 && archived.length === 0) {
			return (
				<EmptyState
					icon="search"
					title="No match"
					message="No projects match your search."
				/>
			);
		}

		return (
			<>
				{groups.length === 0 ? (
					<Note>No active projects match your search.</Note>
				) : (
					groups.map((group) => (
						<View key={group.id}>
							<SectionHeader>{group.name}</SectionHeader>
							<ListCard>
								{group.projects.map((project) => (
									<ProjectRow
										key={project.id}
										project={project}
										onPress={() => openProject(project)}
										actions={actionsFor(project)}
									/>
								))}
							</ListCard>
						</View>
					))
				)}
				{archived.length > 0 ? (
					<View>
						<SectionHeader>Archived</SectionHeader>
						<ListCard>
							<SummaryRow
								title={showArchived ? "Hide archived" : "Show archived"}
								subtitle={`${archived.length} archived`}
								open={showArchived}
								onToggle={() => setArchivedOpen(!showArchived)}
							/>
							{showArchived
								? archived.map((project) => (
										<ProjectRow
											key={project.id}
											project={project}
											onPress={() => openProject(project)}
											actions={actionsFor(project)}
											trailing={
												projectPageAccess(access.isAdmin, project.role)
													.canManageSettings ? (
													<ActionButton
														label="Restore"
														variant="text"
														disabled={archive.isPending}
														onPress={() => restore(project)}
													/>
												) : undefined
											}
										/>
									))
								: null}
						</ListCard>
					</View>
				) : null}
			</>
		);
	};

	return (
		<Screen
			title="Projects"
			largeTitle
			toolbar={
				access.fullApi && access.canManageProjects ? (
					<HeaderActions
						actions={[
							{
								icon: "add",
								label: "New project",
								onPress: () => router.push("/projects/new"),
							},
						]}
					/>
				) : undefined
			}
			overline={
				access.fullApi && list.data
					? `${counts.active} active, ${counts.archived} archived`
					: undefined
			}
			actions={
				access.fullApi && access.canManageProjects ? (
					<IconButton
						icon="add"
						label="New project"
						tone={Platform.OS === "ios" ? "plain" : "tonal"}
						onPress={() => router.push("/projects/new")}
					/>
				) : undefined
			}
			refreshing={list.isRefetching}
			onRefresh={() => void list.refetch()}
		>
			<Inset>
				<ListSearch
					label="Search"
					value={search}
					onChangeText={setSearch}
					placeholder="Project, code or client"
				/>
				{access.fullApi ? (
					<SegmentedControl
						options={PROJECT_SORTS}
						value={sort}
						onChange={setSort}
					/>
				) : null}
			</Inset>
			{body()}
		</Screen>
	);
}
