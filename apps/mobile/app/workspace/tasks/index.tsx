import type { ManagedTask } from "@farmer/api-client";
import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { useAccess } from "../../../src/api/capabilities";
import { useManagedTasks } from "../../../src/api/workspace";
import { HeaderActions } from "../../../src/navigation/header-actions";
import { EmptyState, ErrorState } from "../../../src/ui/components";
import { Screen } from "../../../src/ui/screen";
import { SettingsSection } from "../../../src/ui/settings-list";
import { useTaskArchive } from "../../../src/workspace/catalog/archive";
import { matchesSearch } from "../../../src/workspace/catalog/search";
import {
	FALLBACK_TASK_COLOR,
	TASK_GROUP_LABELS,
	TASK_GROUPS,
} from "../../../src/workspace/catalog/task-groups";
import {
	DetailRow,
	ListSkeleton,
	NoteRow,
	SearchField,
} from "../../../src/workspace/components";
import { formatDay } from "../../../src/workspace/format";

const kindOf = (task: ManagedTask) =>
	task.isAbsence ? "Absence" : task.scope === "site" ? "Built-in" : "Org task";

const entriesOf = (count: number) =>
	`${count} ${count === 1 ? "entry" : "entries"}`;

/** The task list of the workspace, by group, with the archived tasks in
 *  their own section. Admins only, as on the web. */
export default function TasksScreen() {
	const access = useAccess();
	if (access.ready && !access.isAdmin) {
		return (
			<>
				<Stack.Screen options={{ title: "Tasks" }} />
				<Screen topInset={false}>
					<EmptyState
						icon="tasks"
						title="Admins only"
						message="Only an admin can manage the tasks."
					/>
				</Screen>
			</>
		);
	}
	return <TaskList />;
}

function TaskList() {
	const router = useRouter();
	const tasks = useManagedTasks();
	const archive = useTaskArchive();
	const [query, setQuery] = useState("");

	const matching = (tasks.data ?? []).filter((task) =>
		matchesSearch(query, [task.name, task.description]),
	);
	const active = matching.filter((task) => !task.archivedAt);
	const archived = matching.filter((task) => task.archivedAt);
	const searching = query.trim() !== "";

	const row = (task: ManagedTask) => {
		const builtIn = task.scope === "site";
		const dot = (
			<View
				style={{
					width: 10,
					height: 10,
					borderRadius: 5,
					backgroundColor: task.color ?? FALLBACK_TASK_COLOR,
				}}
			/>
		);
		const subtitle = [
			kindOf(task),
			entriesOf(task.entryCount),
			task.archivedAt
				? `Archived ${formatDay(task.archivedAt.slice(0, 10))}`
				: "",
		]
			.filter(Boolean)
			.join(", ");
		const edit = () =>
			router.push({
				pathname: "/workspace/tasks/edit",
				params: { id: task.id },
			});
		// A built-in is the site's, not the organization's. The server refuses
		// every change to it, so the row has no action.
		const onPress = builtIn
			? undefined
			: task.archivedAt
				? () => archive.confirmRestore(task)
				: edit;
		// A built-in has no action. An archived task can only be restored.
		const actions = builtIn
			? []
			: task.archivedAt
				? [
						{
							label: "Restore",
							icon: "restore",
							onPress: () => archive.confirmRestore(task),
						} as const,
					]
				: [
						{ label: "Edit", icon: "edit", onPress: edit } as const,
						{
							label: "Archive",
							icon: "archive",
							destructive: true,
							onPress: () => archive.confirmArchive(task),
						} as const,
					];
		return (
			<DetailRow
				key={task.id}
				title={task.name}
				subtitle={subtitle}
				muted={Boolean(task.archivedAt)}
				trailing={dot}
				onPress={onPress}
				actions={actions}
				accessibilityLabel={`${task.name}, ${subtitle}${
					builtIn
						? ". Built-in, cannot be changed"
						: task.archivedAt
							? ". Press to restore"
							: ""
				}`}
			/>
		);
	};

	return (
		<>
			<Stack.Screen
				options={{
					title: "Tasks",
				}}
			/>
			<HeaderActions
				actions={[
					{
						icon: "add",
						label: "New task",
						onPress: () => router.push("/workspace/tasks/edit"),
					},
				]}
			/>
			<Screen
				topInset={false}
				refreshing={tasks.isRefetching}
				onRefresh={() => void tasks.refetch()}
			>
				{tasks.isPending ? (
					<ListSkeleton />
				) : tasks.isError ? (
					<ErrorState
						error={tasks.error}
						onRetry={() => void tasks.refetch()}
					/>
				) : (
					<>
						<SearchField
							value={query}
							onChangeText={setQuery}
							placeholder="Search tasks"
						/>
						{searching && active.length === 0 ? (
							<SettingsSection>
								<NoteRow>
									{archived.length > 0
										? "Only archived tasks match your search."
										: "No tasks match your search."}
								</NoteRow>
							</SettingsSection>
						) : null}
						{TASK_GROUPS.map((group) => {
							const rows = active.filter((task) => task.group === group);
							if (rows.length === 0) return null;
							return (
								<SettingsSection
									key={group}
									title={`${TASK_GROUP_LABELS[group]} (${rows.length})`}
									footer={
										group === TASK_GROUPS[0]
											? "One global list for the whole company. Built-in tasks cannot be changed. Archiving a task keeps its entries."
											: undefined
									}
								>
									{rows.map(row)}
								</SettingsSection>
							);
						})}
						{archived.length > 0 ? (
							<SettingsSection
								title="Archived"
								footer="Press an archived task to restore it."
							>
								{archived.map(row)}
							</SettingsSection>
						) : null}
					</>
				)}
			</Screen>
		</>
	);
}
