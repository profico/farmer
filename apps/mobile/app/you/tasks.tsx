import { useTasks } from "../../src/api/queries";
import { useHiddenTasks, useSetTaskHidden } from "../../src/api/you";
import {
	EmptyState,
	ErrorBanner,
	ErrorState,
	Text,
} from "../../src/ui/components";
import { messageOf } from "../../src/ui/errors";
import { Inset } from "../../src/ui/screen";
import {
	SettingsLink,
	SettingsSection,
	SettingsSwitch,
} from "../../src/ui/settings-list";
import { usePalette } from "../../src/ui/theme";
import { ListSkeleton, YouScreen } from "../../src/you/components/you-screen";
import { selectableTasks, tasksByGroup } from "../../src/you/tasks";

const DESCRIPTION =
	"Tasks you switch off leave the task list, search included, wherever you log time.";

/**
 * Your tasks: a switch for each task. A task that is off leaves the task
 * list and its search wherever the person logs time. It changes only the
 * pickers: the reports, the API and the engines do not read it.
 */
export default function YourTasksScreen() {
	const palette = usePalette();
	const tasks = useTasks();
	const hidden = useHiddenTasks();
	const setHidden = useSetTaskHidden();

	const refresh = () => {
		void tasks.refetch();
		void hidden.refetch();
	};

	if (tasks.isPending || hidden.isPending) {
		return (
			<YouScreen title="Your tasks">
				<ListSkeleton rows={8} />
			</YouScreen>
		);
	}
	const failed = tasks.error ?? hidden.error;
	if (failed) {
		return (
			<YouScreen title="Your tasks">
				<ErrorState error={failed} onRetry={refresh} />
			</YouScreen>
		);
	}

	const all = tasks.data ? selectableTasks(tasks.data) : [];
	const hiddenIds = new Set(hidden.data?.taskIds);
	const offCount = all.filter((task) => hiddenIds.has(task.id)).length;
	const summary = `${all.length - offCount} of ${all.length} on.`;

	return (
		<YouScreen
			title="Your tasks"
			refreshing={hidden.isRefetching}
			onRefresh={refresh}
		>
			{setHidden.error ? (
				<Inset>
					<ErrorBanner message={messageOf(setHidden.error) ?? ""} />
				</Inset>
			) : null}
			{all.length === 0 ? (
				<EmptyState
					icon="tasks"
					title="No tasks"
					message="This workspace has no tasks yet. An admin adds them."
				/>
			) : (
				<>
					{offCount > 0 ? (
						<SettingsSection footer={`${summary} ${DESCRIPTION}`}>
							<SettingsLink
								icon="check"
								tint="green"
								title="Show all"
								onPress={() =>
									setHidden.mutate({ taskId: null, hidden: false })
								}
							/>
						</SettingsSection>
					) : (
						<Inset>
							<Text variant="bodyMedium" color={palette.onSurfaceVariant}>
								{`${summary} ${DESCRIPTION}`}
							</Text>
						</Inset>
					)}
					{tasksByGroup(all).map(({ group, label, tasks: members }) => (
						<SettingsSection key={group} title={label}>
							{members.map((task) => (
								<SettingsSwitch
									key={task.id}
									title={task.name}
									value={!hiddenIds.has(task.id)}
									onValueChange={(on) =>
										setHidden.mutate({ taskId: task.id, hidden: !on })
									}
								/>
							))}
						</SettingsSection>
					))}
				</>
			)}
		</YouScreen>
	);
}
