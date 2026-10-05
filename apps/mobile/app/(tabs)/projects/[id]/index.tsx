import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { View } from "react-native";

import { useAccess } from "../../../../src/api/capabilities";
import {
	useProjects,
	useStartTimer,
	useTasks,
	useTimer,
} from "../../../../src/api/queries";
import {
	ActionButton,
	EmptyState,
	ErrorBanner,
	ErrorState,
	IconButton,
	ListRow,
	SectionHeader,
	Skeleton,
	Text,
} from "../../../../src/ui/components";
import { messageOf } from "../../../../src/ui/errors";
import { Inset, Screen } from "../../../../src/ui/screen";
import {
	SettingsLink,
	SettingsSection,
} from "../../../../src/ui/settings-list";
import { usePalette } from "../../../../src/ui/theme";
import { SPACE } from "../../../../src/ui/type";

/** The role on the project, in words. A role this app does not know yet
 *  is shown as the server names it. */
const roleName = (role: string) => {
	switch (role) {
		case "member":
			return "Member";
		case "team_lead":
			return "Team lead";
		case "pm":
			return "Project manager";
		default:
			return role;
	}
};

/**
 * One project, and the tasks to start the timer on. The API has no task
 * list for each project, so this is the workspace's list of work tasks.
 */
export default function ProjectScreen() {
	const palette = usePalette();
	const router = useRouter();
	const { id } = useLocalSearchParams<{ id: string }>();
	const projects = useProjects();
	const tasks = useTasks();
	const timer = useTimer();
	const start = useStartTimer();
	const access = useAccess();
	const running = timer.data?.timer ?? null;

	if (projects.isPending) {
		return (
			<Screen topInset={false}>
				<Inset>
					<Skeleton height={64} />
					<Skeleton height={56} />
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

	// A PM runs the project, and a Team Lead on it holds it as a PM. The
	// routes check the same; an admin may manage every project.
	const manages =
		access.fullApi &&
		(access.isAdmin || project.role === "pm" || project.role === "team_lead");

	const startOn = (taskId: string) =>
		start.mutate(
			{ projectId: project.id, taskId },
			{ onSuccess: () => router.navigate("/") },
		);

	return (
		<>
			<Stack.Screen options={{ title: project.code ?? "" }} />
			<Screen topInset={false}>
				<Inset>
					<View style={{ gap: SPACE.xs }}>
						<Text variant="labelLarge" color={palette.onSurfaceVariant}>
							{project.client.name}
						</Text>
						<Text variant="headlineSmall">{project.name}</Text>
						{project.role ? (
							<Text variant="bodyMedium" color={palette.onSurfaceVariant}>
								{roleName(project.role)}
							</Text>
						) : null}
					</View>
					{start.error ? (
						<ErrorBanner message={messageOf(start.error) ?? ""} />
					) : null}
					<View
						style={{ flexDirection: "row", gap: SPACE.s, flexWrap: "wrap" }}
					>
						<ActionButton
							label="Start timer here"
							disabled={running !== null}
							onPress={() =>
								router.push({
									pathname: "/start-timer",
									params: { projectId: project.id },
								})
							}
						/>
						<ActionButton
							label="Log time"
							variant="outlined"
							onPress={() =>
								router.push({
									pathname: "/entry",
									params: { projectId: project.id },
								})
							}
						/>
					</View>
					{running ? (
						<Text variant="bodySmall" color={palette.onSurfaceVariant}>
							A timer is already running. Stop it before you start another.
						</Text>
					) : null}
				</Inset>
				{manages ? (
					<SettingsSection title="Manage">
						<SettingsLink
							icon="settings"
							tint="gray"
							title="Settings"
							subtitle="Name, code, client, budget and access"
							onPress={() =>
								router.push({
									pathname: "/projects/[id]/settings",
									params: { id: project.id },
								})
							}
						/>
						<SettingsLink
							icon="team"
							tint="blue"
							title="Team"
							subtitle="The people on the project and their roles"
							onPress={() =>
								router.push({
									pathname: "/projects/[id]/team",
									params: { id: project.id },
								})
							}
						/>
					</SettingsSection>
				) : null}
				<SectionHeader>Tasks</SectionHeader>
				{tasks.isPending ? (
					<Inset>
						<Skeleton height={56} />
					</Inset>
				) : tasks.isError ? (
					<ErrorState
						error={tasks.error}
						onRetry={() => void tasks.refetch()}
					/>
				) : (
					<View
						style={{
							marginHorizontal: SPACE.l,
							borderRadius: 16,
							overflow: "hidden",
							backgroundColor: palette.surfaceContainer,
						}}
					>
						{tasks.data.tasks.map((task) => (
							<ListRow
								key={task.id}
								title={task.name}
								subtitle={task.group}
								trailing={
									running ? undefined : (
										<IconButton
											icon="play"
											label={`Start the timer on ${task.name}`}
											onPress={() => startOn(task.id)}
											disabled={start.isPending}
										/>
									)
								}
							/>
						))}
					</View>
				)}
			</Screen>
		</>
	);
}
