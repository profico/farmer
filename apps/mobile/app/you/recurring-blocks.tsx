import { useRouter } from "expo-router";

import { useTasks, useWhoami } from "../../src/api/queries";
import { useEnableBreakBlock, useRecurringBlocks } from "../../src/api/you";
import { formatHours } from "../../src/lib/duration";
import { EmptyState, ErrorBanner, ErrorState } from "../../src/ui/components";
import { messageOf } from "../../src/ui/errors";
import { Inset } from "../../src/ui/screen";
import {
	SettingsLink,
	SettingsSection,
	SettingsSwitch,
} from "../../src/ui/settings-list";
import { ListSkeleton, YouScreen } from "../../src/you/components/you-screen";
import { useConfirmDeleteBlock } from "../../src/you/confirm-delete";
import { daysSummary, hoursLabel } from "../../src/you/format";

/** The break the app suggests, as the server makes it: Monday to Friday,
 *  30 minutes, no project. */
const SUGGESTED_BREAK = { daysOfWeek: [1, 2, 3, 4, 5], durationSeconds: 1800 };

/**
 * The recurring blocks: time, such as a daily break or a standing meeting,
 * that goes on the timesheet without the person logging it. A press opens
 * a block to change, pause or delete it. A long press offers Edit and Delete.
 */
export default function RecurringBlocksScreen() {
	const router = useRouter();
	const whoami = useWhoami();
	const blocks = useRecurringBlocks();
	const tasks = useTasks();
	const enableBreak = useEnableBreakBlock();
	const remove = useConfirmDeleteBlock();
	const weekStartsOn = whoami.data?.weekStartsOn ?? 1;

	// The break is found by its system key, never by its name: an admin can
	// rename the task. The suggestion shows only while the person has no
	// break block, a paused one included, because that is a choice they
	// already made.
	const breakTask = tasks.data
		? [...tasks.data.tasks, ...tasks.data.absenceTasks].find(
				(task) => task.systemKey === "break",
			)
		: undefined;
	const suggestBreak =
		breakTask !== undefined &&
		blocks.data !== undefined &&
		!blocks.data.some((block) => block.task.id === breakTask.id);

	const add = () => router.push("/you/recurring-block");
	const edit = (id: string) =>
		router.push({ pathname: "/you/recurring-block", params: { id } });

	return (
		<YouScreen
			title="Recurring blocks"
			action={{ icon: "add", label: "New recurring block", onPress: add }}
			refreshing={blocks.isRefetching}
			onRefresh={() => void blocks.refetch()}
		>
			{enableBreak.error ? (
				<Inset>
					<ErrorBanner message={messageOf(enableBreak.error) ?? ""} />
				</Inset>
			) : null}
			{blocks.isPending ? (
				<ListSkeleton rows={3} />
			) : blocks.isError ? (
				<ErrorState
					error={blocks.error}
					onRetry={() => void blocks.refetch()}
				/>
			) : (
				<>
					{suggestBreak && breakTask ? (
						<SettingsSection
							title="Suggested"
							footer="Turn it on to add the break to every working day. After that you can change or delete it like any other block."
						>
							<SettingsSwitch
								icon="repeat"
								tint="green"
								title={breakTask.name}
								subtitle={`${daysSummary(
									SUGGESTED_BREAK.daysOfWeek,
									weekStartsOn,
								)}, ${formatHours(SUGGESTED_BREAK.durationSeconds)}`}
								value={enableBreak.isPending}
								disabled={enableBreak.isPending}
								onValueChange={(on) => {
									if (on) enableBreak.mutate();
								}}
							/>
						</SettingsSection>
					) : null}
					{blocks.data.length === 0 ? (
						<EmptyState
							icon="repeat"
							title="No recurring blocks"
							message="A block, such as a daily break or a standing meeting, goes on your timesheet without you logging it."
						/>
					) : (
						<SettingsSection footer="A block reserves an amount of time on a weekday, not a time on the clock.">
							{blocks.data.map((block) => (
								<SettingsLink
									key={block.id}
									title={block.task.name}
									subtitle={[
										block.project?.name,
										daysSummary(block.daysOfWeek, weekStartsOn),
										hoursLabel(block.durationSeconds),
									]
										.filter((part) => part)
										.join(", ")}
									value={block.active ? "" : "Paused"}
									onPress={() => edit(block.id)}
									actions={[
										{
											label: "Edit",
											icon: "edit",
											onPress: () => edit(block.id),
										},
										{
											label: "Delete",
											icon: "delete",
											destructive: true,
											onPress: () => remove.confirm(block),
										},
									]}
								/>
							))}
						</SettingsSection>
					)}
				</>
			)}
			<SettingsSection
				title="Related"
				footer="Your working hours set the days that a block fills."
			>
				<SettingsLink
					icon="schedule"
					tint="blue"
					title="My schedule"
					onPress={() => router.push("/you/schedule")}
				/>
			</SettingsSection>
		</YouScreen>
	);
}
