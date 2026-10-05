import type { Project, ProjectDetail } from "@farmer/api-client";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, View } from "react-native";

import { useAccess } from "../../../src/api/capabilities";
import {
	useArchiveProject,
	useClients,
	useProjectList,
} from "../../../src/api/projects";
import { useProjects } from "../../../src/api/queries";
import { projectPageAccess } from "../../../src/projects/access";
import { ProjectRow } from "../../../src/projects/components/project-row";
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
	Field,
	IconButton,
	ListRow,
	SectionHeader,
	Skeleton,
} from "../../../src/ui/components";
import { messageOf } from "../../../src/ui/errors";
import { Icon } from "../../../src/ui/icon";
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
							icon="folder"
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
	const clients = useClients(access.canManageProjects);
	const archive = useArchiveProject();
	const [search, setSearch] = useState("");
	const [sort, setSort] = useState<ProjectSort>("month");
	const [archivedOpen, setArchivedOpen] = useState(false);

	const openProject = (project: ProjectDetail) =>
		router.push({ pathname: "/projects/[id]", params: { id: project.id } });

	const restore = (project: ProjectDetail) =>
		Alert.alert(
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
									Alert.alert(
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
							: "No projects have been created yet."
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
						tone="tonal"
						onPress={() => router.push("/projects/new")}
					/>
				) : undefined
			}
			refreshing={list.isRefetching}
			onRefresh={() => void list.refetch()}
		>
			<Inset>
				<Field
					label="Search"
					value={search}
					onChangeText={setSearch}
					placeholder="Project, code or client"
					autoCorrect={false}
					clearButtonMode="while-editing"
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
