import type { UnfiledEntry } from "@farmer/api-client";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { View } from "react-native";

import { useAccess } from "../../src/api/capabilities";
import { useEntries, useUnfiled } from "../../src/api/queries";
import {
	useFileEntries,
	useRemoveEntries,
	useRestoreEntries,
} from "../../src/api/time";
import { ProjectPicker, TaskPicker } from "../../src/forms/pickers";
import { Sheet } from "../../src/forms/sheet";
import { formatHours } from "../../src/lib/duration";
import { CheckRow } from "../../src/time/components/check-row";
import { type Notice, Snackbar } from "../../src/time/components/snackbar";
import { SwitchRow } from "../../src/time/components/switch-row";
import { committed } from "../../src/time/haptics";
import {
	groupUnfiled,
	restoreBody,
	selectionOf,
	toggleIds,
	type UnfiledGroup,
} from "../../src/time/unfiled";
import {
	EmptyState,
	ErrorState,
	IconButton,
	Skeleton,
	Text,
} from "../../src/ui/components";
import { messageOf } from "../../src/ui/errors";
import { usePalette } from "../../src/ui/theme";
import { SPACE } from "../../src/ui/type";

type Params = { from: string; to: string; scope?: string };

const shortDay = (day: string) =>
	new Intl.DateTimeFormat(undefined, {
		weekday: "short",
		day: "numeric",
		month: "short",
		timeZone: "UTC",
	}).format(new Date(`${day}T12:00:00Z`));

/**
 * File the time with no project: tick the entries that belong to one
 * project, pick it, and file them together. "Always file these here" adds a
 * filing rule for the next meetings with the same title. Remove is for time
 * that did not happen, and Undo puts it back.
 */
export default function UnfiledSheet() {
	const params = useLocalSearchParams<Params>();
	const palette = usePalette();
	const { fullApi } = useAccess();
	const unfiled = useUnfiled(params.from, params.to);
	// The same range as the screen behind. It tells a rest-of-day block,
	// which Undo cannot put back, from the other entries.
	const entries = useEntries(params.from, params.to);
	const file = useFileEntries();
	const remove = useRemoveEntries();
	const restore = useRestoreEntries();
	const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
	const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
	const [projectId, setProjectId] = useState<string | null>(null);
	const [changeTask, setChangeTask] = useState(false);
	const [taskId, setTaskId] = useState<string | null>(null);
	const [remember, setRemember] = useState(false);
	const [notice, setNotice] = useState<Notice | null>(null);
	const hideNotice = useCallback(() => setNotice(null), []);

	const list = unfiled.data ?? [];
	const groups = groupUnfiled(list);
	const selectedSeconds = list
		.filter((entry) => selected.has(entry.id))
		.reduce((sum, entry) => sum + entry.durationSeconds, 0);
	const busy = file.isPending || remove.isPending || restore.isPending;
	const fills = new Set(
		(entries.data ?? [])
			.filter((entry) => entry.fillsDay)
			.map((entry) => entry.id),
	);

	const fileSelected = () => {
		if (!projectId || selected.size === 0) return;
		file.mutate(
			{
				timeEntryIds: [...selected],
				projectId,
				taskId: changeTask ? (taskId ?? undefined) : undefined,
				remember,
			},
			{
				onSuccess: (result) => {
					setSelected(new Set());
					if (result.failed > 0) {
						setNotice({
							id: Date.now(),
							tone: "warning",
							message: `Filed ${result.filed}. ${result.failed} could not be filed: ${result.firstError ?? "the server gave no reason"}.`,
						});
						return;
					}
					committed();
					setNotice({
						id: Date.now(),
						message:
							result.filed === 1
								? "Filed 1 entry."
								: `Filed ${result.filed} entries.`,
					});
				},
				onError: (error) =>
					setNotice({
						id: Date.now(),
						tone: "warning",
						message: messageOf(error) ?? "",
					}),
			},
		);
	};

	const removeEntries = (removed: UnfiledEntry[]) =>
		remove.mutate(
			removed.map((entry) => entry.id),
			{
				onSuccess: ({ removed: ids, firstError }) => {
					setSelected((current) => {
						const next = new Set(current);
						for (const id of ids) next.delete(id);
						return next;
					});
					if (firstError !== null) {
						setNotice({
							id: Date.now(),
							tone: "warning",
							message: `Removed ${ids.length} of ${removed.length}: ${firstError}`,
						});
						return;
					}
					// The delete answers only the id, so Undo puts back what this
					// screen read. A rest-of-day block is sized from the day, and
					// a copy of it is not the same thing.
					const back = removed
						.filter((entry) => ids.includes(entry.id) && !fills.has(entry.id))
						.map(restoreBody);
					setNotice({
						id: Date.now(),
						message:
							ids.length === 1
								? "Removed 1 entry."
								: `Removed ${ids.length} entries.`,
						action:
							back.length > 0
								? {
										label: "Undo",
										onPress: () =>
											restore.mutate(back, {
												onSuccess: () =>
													setNotice({
														id: Date.now(),
														message:
															back.length === 1
																? "Put back 1 entry."
																: `Put back ${back.length} entries.`,
													}),
												onError: (error) =>
													setNotice({
														id: Date.now(),
														tone: "warning",
														message: messageOf(error) ?? "",
													}),
											}),
									}
								: undefined,
					});
				},
			},
		);

	const fileLabel =
		selected.size === 0
			? "Tick the entries to file."
			: `${selected.size} selected, ${formatHours(selectedSeconds)}`;

	return (
		<View style={{ flex: 1 }}>
			<Sheet
				title="File your time"
				actionLabel="File"
				onAction={fileSelected}
				busy={busy}
				actionDisabled={
					!fullApi ||
					selected.size === 0 ||
					!projectId ||
					(changeTask && !taskId)
				}
			>
				{unfiled.isPending ? (
					<Skeleton height={168} radius={16} />
				) : unfiled.isError ? (
					<ErrorState
						error={unfiled.error}
						onRetry={() => void unfiled.refetch()}
					/>
				) : groups.length === 0 ? (
					<EmptyState
						icon="check"
						title="Everything is filed"
						message={`No time ${params.scope ?? "in this range"} is without a project.`}
					/>
				) : (
					<>
						<Text variant="bodyMedium" color={palette.onSurfaceVariant}>
							Tick the entries that belong to one project, pick the project and
							file them together. Change the task only when it is wrong.
						</Text>
						<View
							style={{
								borderRadius: 16,
								overflow: "hidden",
								backgroundColor: palette.surfaceContainer,
							}}
						>
							{groups.map((group, index) => (
								<GroupRows
									key={group.key}
									group={group}
									first={index === 0}
									selected={selected}
									open={expanded.has(group.key)}
									busy={busy}
									onToggleOpen={() =>
										setExpanded((current) => toggleIds(current, [group.key]))
									}
									onToggle={(ids) =>
										setSelected((current) => toggleIds(current, ids))
									}
									onRemove={removeEntries}
								/>
							))}
						</View>
						{fullApi ? (
							<>
								<Text variant="labelLarge">{fileLabel}</Text>
								<ProjectPicker
									value={projectId}
									onChange={setProjectId}
									allowNone={false}
								/>
								<SwitchRow
									title="Change the task"
									description={
										changeTask ? undefined : "Each entry keeps its own task."
									}
									value={changeTask}
									onValueChange={setChangeTask}
								/>
								{changeTask ? (
									<TaskPicker
										value={taskId}
										onChange={(task) => setTaskId(task.id)}
									/>
								) : null}
								<SwitchRow
									title="Always file these here"
									description="File the next meetings with the same title to this project. You can change this in your preferences."
									value={remember}
									onValueChange={setRemember}
								/>
							</>
						) : (
							<Text variant="bodyMedium" color={palette.onSurfaceVariant}>
								This server cannot file time from the app yet. Use Farmer on the
								web.
							</Text>
						)}
					</>
				)}
				{/* Room for the snackbar over the end of the list. */}
				<View style={{ height: SPACE.xxl * 2 }} />
			</Sheet>
			<Snackbar notice={notice} onHide={hideNotice} floating />
		</View>
	);
}

/** A group, and its entries under it when it is open. */
function GroupRows({
	group,
	first,
	selected,
	open,
	busy,
	onToggleOpen,
	onToggle,
	onRemove,
}: {
	group: UnfiledGroup;
	first: boolean;
	selected: ReadonlySet<string>;
	open: boolean;
	busy: boolean;
	onToggleOpen: () => void;
	onToggle: (ids: string[]) => void;
	onRemove: (entries: UnfiledEntry[]) => void;
}) {
	const palette = usePalette();
	const ids = group.entries.map((entry) => entry.id);
	const state = selectionOf(selected, ids);
	const many = group.entries.length > 1;
	const single = group.entries[0];
	const when = many
		? `${group.entries.length} times`
		: single
			? shortDay(single.date)
			: "";
	return (
		<View
			style={{
				borderTopWidth: first ? 0 : 1,
				borderTopColor: palette.outlineVariant,
			}}
		>
			<View style={{ flexDirection: "row", alignItems: "center" }}>
				<CheckRow
					checked={state === "all" ? true : state === "some" ? "mixed" : false}
					onPress={() => onToggle(ids)}
					label={`${group.title}, ${group.taskName}, ${when}, ${formatHours(group.seconds)}`}
				>
					<Text variant="bodyLarge" numberOfLines={1}>
						{group.title}
					</Text>
					<Text
						variant="bodyMedium"
						color={palette.onSurfaceVariant}
						numberOfLines={1}
					>
						{group.taskName}, {when}, {formatHours(group.seconds)}
					</Text>
				</CheckRow>
				{many ? (
					<IconButton
						icon={open ? "close" : "calendar"}
						label={
							open
								? `Hide the days of ${group.title}`
								: `Show the days of ${group.title}`
						}
						onPress={onToggleOpen}
					/>
				) : null}
				<IconButton
					icon="delete"
					label={
						many
							? `Remove all ${group.entries.length} entries of ${group.title}`
							: `Remove ${group.title}`
					}
					onPress={() => onRemove(group.entries)}
					disabled={busy}
				/>
			</View>
			{open
				? group.entries.map((entry) => (
						<View
							key={entry.id}
							style={{ flexDirection: "row", alignItems: "center" }}
						>
							<CheckRow
								indent={SPACE.l}
								checked={selected.has(entry.id)}
								onPress={() => onToggle([entry.id])}
								label={`${group.title} on ${shortDay(entry.date)}, ${formatHours(entry.durationSeconds)}`}
							>
								<Text variant="bodyMedium">
									{shortDay(entry.date)}, {formatHours(entry.durationSeconds)}
								</Text>
							</CheckRow>
							<IconButton
								icon="delete"
								label={`Remove ${group.title} on ${shortDay(entry.date)}`}
								onPress={() => onRemove([entry])}
								disabled={busy}
							/>
						</View>
					))
				: null}
		</View>
	);
}
