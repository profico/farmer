import type { Project } from "@farmer/api-client";
import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { useProjects } from "../../../src/api/queries";
import {
	EmptyState,
	ErrorState,
	Field,
	ListRow,
	SectionHeader,
	Skeleton,
} from "../../../src/ui/components";
import { Icon } from "../../../src/ui/icon";
import { Inset, Screen } from "../../../src/ui/screen";
import { usePalette } from "../../../src/ui/theme";
import { SPACE } from "../../../src/ui/type";

const byClient = (projects: Project[]) => {
	const groups = new Map<string, Project[]>();
	for (const project of projects) {
		const name = project.client.name;
		groups.set(name, [...(groups.get(name) ?? []), project]);
	}
	return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
};

const matches = (project: Project, search: string) => {
	const needle = search.trim().toLowerCase();
	if (!needle) return true;
	return [project.name, project.code ?? "", project.client.name].some((text) =>
		text.toLowerCase().includes(needle),
	);
};

/** The projects the person may log time to, by client. */
export default function ProjectsScreen() {
	const palette = usePalette();
	const router = useRouter();
	const projects = useProjects();
	const [search, setSearch] = useState("");

	return (
		<Screen
			title="Projects"
			refreshing={projects.isRefetching}
			onRefresh={() => void projects.refetch()}
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
			</Inset>
			{projects.isPending ? (
				<Inset>
					<Skeleton height={56} />
					<Skeleton height={56} />
					<Skeleton height={56} />
				</Inset>
			) : projects.isError ? (
				<ErrorState
					error={projects.error}
					onRetry={() => void projects.refetch()}
				/>
			) : projects.data.length === 0 ? (
				<EmptyState
					icon="folder"
					title="No projects"
					message="You are not on a project in this workspace yet. You can still log time with no project."
				/>
			) : (
				(() => {
					const groups = byClient(
						projects.data.filter((project) => matches(project, search)),
					);
					if (groups.length === 0) {
						return (
							<EmptyState
								icon="search"
								title="No match"
								message={`No project matches "${search.trim()}".`}
							/>
						);
					}
					return groups.map(([client, members]) => (
						<View key={client}>
							<SectionHeader>{client}</SectionHeader>
							<View
								style={{
									marginHorizontal: SPACE.l,
									borderRadius: 16,
									overflow: "hidden",
									backgroundColor: palette.surfaceContainer,
								}}
							>
								{members.map((project) => (
									<ListRow
										key={project.id}
										icon="folder"
										title={project.name}
										subtitle={project.code ?? undefined}
										onPress={() => router.push(`/projects/${project.id}`)}
										trailing={
											<Icon
												name="forward"
												size={20}
												color={palette.onSurfaceVariant}
											/>
										}
									/>
								))}
							</View>
						</View>
					));
				})()
			)}
		</Screen>
	);
}
