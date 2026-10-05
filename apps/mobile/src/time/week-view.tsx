import type { TimeEntry } from "@farmer/api-client";
import type { UseQueryResult } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { Alert, Pressable, View } from "react-native";

import { useProjects, useTasks, useTracking } from "../api/queries";
import { useHome, useRemoveRow, useWriteCell } from "../api/time";
import { ProjectPicker, TaskPicker } from "../forms/pickers";
import { dayOfMonth, weekdayShort } from "../lib/days";
import { formatHours } from "../lib/duration";
import {
	ActionButton,
	Card,
	EmptyState,
	ErrorState,
	IconButton,
	Skeleton,
	Text,
} from "../ui/components";
import { messageOf } from "../ui/errors";
import { Inset } from "../ui/screen";
import { usePalette } from "../ui/theme";
import { SPACE } from "../ui/type";
import { type ChartDay, WeekChart } from "./components/week-chart";
import { weekDayMarks } from "./day-marks";
import {
	buildRows,
	cellSeconds,
	daySeconds,
	type DraftRow,
	type GridRow,
	rowDeletions,
	rowKey,
	rowSeconds,
	stepCell,
} from "./week-grid";

/** How long the stepper waits after the last tap before it writes. */
const SETTLE_MS = 700;

export type Notify = (message: string, tone?: "plain" | "warning") => void;

/**
 * The stepper of one cell: the row on the selected day, in 15-minute steps.
 * The taps are written together once they stop, so a run of taps is one
 * write and one read of the week. A change of day or screen writes what is
 * still waiting.
 */
function CellStepper({
	row,
	date,
	dayTotal,
	onFailure,
}: {
	row: GridRow;
	date: string;
	dayTotal: number;
	onFailure: (message: string) => void;
}) {
	const palette = usePalette();
	const write = useWriteCell();
	const stored = cellSeconds(row, date);
	const [pending, setPending] = useState<number | null>(null);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	// What a flush reads: the newest figure, the cell it belongs to, and the
	// write. A flush runs from a timer or as the stepper goes away, after
	// the render that set them.
	const latest = useRef({
		pending,
		row,
		date,
		stored,
		write: write.mutateAsync,
		onFailure,
	});
	useLayoutEffect(() => {
		latest.current = {
			pending,
			row,
			date,
			stored,
			write: write.mutateAsync,
			onFailure,
		};
	});

	const flush = useCallback(() => {
		if (timer.current) clearTimeout(timer.current);
		timer.current = null;
		const current = latest.current;
		if (current.pending == null || current.pending === current.stored) {
			setPending(null);
			return;
		}
		void current
			.write({
				cell: current.row.byDate.get(current.date) ?? [],
				date: current.date,
				projectId: current.row.projectId,
				taskId: current.row.taskId,
				durationSeconds: current.pending,
			})
			.catch((error: Error) => current.onFailure(messageOf(error) ?? ""))
			.finally(() => setPending(null));
	}, []);

	useEffect(
		() => () => {
			if (timer.current) flush();
		},
		[flush],
	);

	const shown = pending ?? stored;
	const total = dayTotal - stored + shown;
	const step = (steps: number) => {
		setPending(stepCell(shown, steps, total));
		if (timer.current) clearTimeout(timer.current);
		timer.current = setTimeout(flush, SETTLE_MS);
	};
	const label = `${row.heading}${row.taskName ? `, ${row.taskName}` : ""}, ${weekdayShort(date)} ${dayOfMonth(date)}`;

	if (row.locked) {
		return (
			<Text variant="bodySmall" color={palette.onSurfaceVariant}>
				A rest-of-day block is in this row. Its time follows the day, so change
				it in the day view.
			</Text>
		);
	}
	return (
		<View
			style={{
				flexDirection: "row",
				alignItems: "center",
				gap: SPACE.m,
				backgroundColor: palette.surfaceContainerHigh,
				borderRadius: 16,
				padding: SPACE.xs,
			}}
		>
			<IconButton
				icon="minus"
				label={`15 minutes less on ${label}`}
				tone="tonal"
				onPress={() => step(-1)}
				disabled={shown === 0}
			/>
			<View
				style={{ flex: 1, alignItems: "center" }}
				accessible
				accessibilityLabel={`${label}: ${formatHours(shown)}`}
				accessibilityLiveRegion="polite"
			>
				<Text variant="titleLarge">{formatHours(shown)}</Text>
				<Text variant="bodySmall" color={palette.onSurfaceVariant}>
					{weekdayShort(date)} {dayOfMonth(date)}
					{write.isPending || pending != null ? ", saving" : ""}
				</Text>
			</View>
			<IconButton
				icon="add"
				label={`15 minutes more on ${label}`}
				tone="tonal"
				onPress={() => step(1)}
				disabled={stepCell(shown, 1, total) === shown}
			/>
		</View>
	);
}

/** One row of the week: its seven days, the stepper of the selected day,
 *  its notes and its removal. */
function RowCard({
	row,
	days,
	selected,
	entries,
	onSelect,
	onNotes,
	onRemove,
	removing,
	onFailure,
}: {
	row: GridRow;
	days: string[];
	selected: string;
	entries: readonly TimeEntry[];
	onSelect: (day: string) => void;
	onNotes: () => void;
	onRemove: () => void;
	removing: boolean;
	onFailure: (message: string) => void;
}) {
	const palette = usePalette();
	const total = rowSeconds(row, days);
	return (
		<Card style={{ gap: SPACE.m }}>
			<View
				style={{ flexDirection: "row", alignItems: "center", gap: SPACE.s }}
			>
				<View style={{ flex: 1 }}>
					<Text variant="titleMedium" numberOfLines={1}>
						{row.heading}
					</Text>
					{row.taskName ? (
						<Text
							variant="bodyMedium"
							color={palette.onSurfaceVariant}
							numberOfLines={1}
						>
							{row.taskName}
						</Text>
					) : null}
				</View>
				<Text variant="titleMedium">{formatHours(total)}</Text>
				{total > 0 ? (
					<IconButton
						icon="edit"
						label={`Notes for ${row.heading}`}
						onPress={onNotes}
					/>
				) : null}
				{row.locked ? null : (
					<IconButton
						icon="delete"
						label={`Remove ${row.heading}`}
						onPress={onRemove}
						disabled={removing}
					/>
				)}
			</View>
			<View style={{ flexDirection: "row", gap: 2 }}>
				{days.map((date) => {
					const seconds = cellSeconds(row, date);
					const isSelected = date === selected;
					const hasNote = (row.byDate.get(date) ?? []).some(
						(entry) => entry.description,
					);
					return (
						<Pressable
							key={date}
							accessibilityRole="button"
							accessibilityState={{ selected: isSelected }}
							accessibilityLabel={`${row.heading}, ${weekdayShort(date)} ${dayOfMonth(date)}, ${formatHours(seconds)}${hasNote ? ", has a note" : ""}`}
							onPress={() => onSelect(date)}
							style={{
								flex: 1,
								alignItems: "center",
								paddingVertical: SPACE.xs,
								borderRadius: 8,
								borderWidth: 1,
								borderColor: isSelected
									? palette.primary
									: palette.outlineVariant,
								backgroundColor: isSelected
									? palette.secondaryContainer
									: undefined,
							}}
						>
							<Text variant="labelMedium" color={palette.onSurfaceVariant}>
								{weekdayShort(date).slice(0, 2)}
							</Text>
							<Text
								variant="bodySmall"
								color={
									seconds > 0 ? palette.onSurface : palette.onSurfaceVariant
								}
							>
								{seconds > 0 ? formatHours(seconds) : "0"}
							</Text>
						</Pressable>
					);
				})}
			</View>
			{days.includes(selected) ? (
				<CellStepper
					key={`${row.key}:${selected}`}
					row={row}
					date={selected}
					dayTotal={daySeconds(entries, selected)}
					onFailure={onFailure}
				/>
			) : null}
		</Card>
	);
}

/** Adds an empty row: the work, and nothing else. The hours come next, and
 *  the notes after them, as on the web. */
function AddRow({
	existing,
	onAdd,
}: {
	existing: ReadonlySet<string>;
	onAdd: (row: DraftRow) => void;
}) {
	const palette = usePalette();
	const tasks = useTasks();
	const projects = useProjects();
	const [open, setOpen] = useState(false);
	const [projectId, setProjectId] = useState<string | null>(null);
	const [taskId, setTaskId] = useState<string | null>(null);
	const projectName =
		projects.data?.find((project) => project.id === projectId)?.name ?? null;

	if (!open) {
		return (
			<View style={{ flexDirection: "row" }}>
				<ActionButton
					label="Add a row"
					variant="outlined"
					onPress={() => setOpen(true)}
				/>
			</View>
		);
	}
	const all = [
		...(tasks.data?.tasks ?? []),
		...(tasks.data?.absenceTasks ?? []),
	];
	const task = all.find((item) => item.id === taskId);
	const key = taskId ? rowKey(projectId, taskId) : null;
	const duplicate = key != null && existing.has(key);
	return (
		<Card style={{ gap: SPACE.m }}>
			<Text variant="titleMedium">Add a row</Text>
			<ProjectPicker
				value={projectId}
				onChange={(id) => {
					setProjectId(id);
					setTaskId(null);
				}}
			/>
			<TaskPicker
				value={taskId}
				includeAbsence={projectId === null}
				onChange={(picked) => setTaskId(picked.id)}
			/>
			{duplicate ? (
				<Text variant="bodySmall" color={palette.error}>
					This row is already in the week.
				</Text>
			) : null}
			<View style={{ flexDirection: "row", gap: SPACE.s }}>
				<ActionButton
					label="Add"
					disabled={!task || duplicate}
					onPress={() => {
						if (!task || !key) return;
						onAdd({
							key,
							projectId,
							taskId: task.id,
							heading: projectName ?? task.name,
							taskName: projectName ? task.name : "",
							isAbsence: task.isAbsence,
						});
						setOpen(false);
						setProjectId(null);
						setTaskId(null);
					}}
				/>
				<ActionButton
					label="Cancel"
					variant="text"
					onPress={() => setOpen(false)}
				/>
			</View>
		</Card>
	);
}

/**
 * The week as rows of work: one row for each project and task. A row's
 * days are seven small cells, and the selected day has a stepper in
 * 15-minute steps. A row with a rest-of-day block is changed in the day
 * view, because its time follows the day.
 */
export function WeekView({
	days,
	today,
	selected,
	entries,
	holidays,
	onSelect,
	onNotify,
	onCopyPreviousWeek,
	copying,
}: {
	days: string[];
	today: string;
	selected: string;
	entries: UseQueryResult<TimeEntry[]>;
	holidays: ReadonlyMap<string, string> | undefined;
	onSelect: (day: string) => void;
	onNotify: Notify;
	onCopyPreviousWeek?: () => void;
	copying: boolean;
}) {
	const palette = usePalette();
	const router = useRouter();
	const from = days[0] ?? selected;
	const to = days[6] ?? selected;
	const isCurrentWeek = days.includes(today);
	const home = useHome(isCurrentWeek);
	const tracking = useTracking();
	const removeRow = useRemoveRow(from, to);

	// Rows added with no hours yet. They belong to one week, so a new week
	// starts without them.
	const [drafts, setDrafts] = useState<DraftRow[]>([]);
	const [draftWeek, setDraftWeek] = useState(from);
	if (draftWeek !== from) {
		setDraftWeek(from);
		setDrafts([]);
	}

	const list = entries.data ?? [];
	const rows = buildRows(list, drafts);
	const weekTotal = list.reduce((sum, entry) => sum + entry.durationSeconds, 0);

	// The chart: this week from the server's own marks, another week from
	// the same rule here.
	const totals = new Map(days.map((date) => [date, daySeconds(list, date)]));
	const daySecondsTarget =
		tracking.data && tracking.data.week.targetSeconds != null
			? tracking.data.daySeconds
			: null;
	const localMarks =
		daySecondsTarget != null
			? weekDayMarks({
					dates: days,
					secondsByDay: totals,
					holidays: holidays ?? new Map(),
					today,
					daySeconds: daySecondsTarget,
				})
			: new Map();
	const chartDays: ChartDay[] =
		isCurrentWeek && home.data && home.data.from === from
			? home.data.days.map((day) => ({
					date: day.date,
					// The entries are the newer read after a write.
					seconds: totals.get(day.date) ?? day.seconds,
					holiday: day.holiday,
					mark: day.mark,
				}))
			: days.map((date) => ({
					date,
					seconds: totals.get(date) ?? 0,
					holiday: holidays?.get(date) ?? null,
					mark: localMarks.get(date) ?? null,
				}));
	const chartTarget =
		isCurrentWeek && home.data ? home.data.daySeconds : daySecondsTarget;

	const confirmRemove = (row: GridRow) => {
		const ids = rowDeletions(row);
		if (ids.flat().length === 0) {
			setDrafts((current) => current.filter((draft) => draft.key !== row.key));
			return;
		}
		Alert.alert(
			`Remove ${row.heading}?`,
			`This deletes ${formatHours(rowSeconds(row, days))} of this week's time in the row.`,
			[
				{ text: "Cancel", style: "cancel" },
				{
					text: "Remove",
					style: "destructive",
					onPress: () => {
						setDrafts((current) =>
							current.filter((draft) => draft.key !== row.key),
						);
						removeRow.mutate(ids, {
							onError: (error) => onNotify(messageOf(error) ?? "", "warning"),
						});
					},
				},
			],
		);
	};

	return (
		<Inset>
			<Card>
				<View
					style={{
						flexDirection: "row",
						justifyContent: "space-between",
						alignItems: "baseline",
					}}
				>
					<Text variant="titleSmall" color={palette.onSurfaceVariant}>
						{isCurrentWeek ? "This week by day" : "The week by day"}
					</Text>
					<Text variant="titleMedium">{formatHours(weekTotal)}</Text>
				</View>
				<WeekChart
					days={chartDays}
					daySeconds={chartTarget}
					selected={selected}
					today={today}
					onSelect={onSelect}
				/>
			</Card>
			{entries.isPending ? (
				<>
					<Skeleton height={140} radius={16} />
					<Skeleton height={140} radius={16} />
				</>
			) : entries.isError ? (
				<ErrorState
					error={entries.error}
					onRetry={() => void entries.refetch()}
				/>
			) : rows.length === 0 ? (
				<EmptyState
					icon="calendar"
					title="Nothing logged this week"
					message="Add a row to start filling it in, or copy the week before."
				/>
			) : (
				rows.map((row) => (
					<RowCard
						key={row.key}
						row={row}
						days={days}
						selected={selected}
						entries={list}
						onSelect={onSelect}
						onNotes={() =>
							router.push({
								pathname: "/time/notes",
								params: {
									from,
									to,
									projectId: row.projectId ?? "",
									taskId: row.taskId,
								},
							})
						}
						onRemove={() => confirmRemove(row)}
						removing={removeRow.isPending}
						onFailure={(message) => onNotify(message, "warning")}
					/>
				))
			)}
			<AddRow
				existing={new Set(rows.map((row) => row.key))}
				onAdd={(row) => setDrafts((current) => [...current, row])}
			/>
			{onCopyPreviousWeek ? (
				<View style={{ flexDirection: "row" }}>
					<ActionButton
						label="Copy the previous week"
						variant="text"
						onPress={onCopyPreviousWeek}
						disabled={copying}
					/>
				</View>
			) : null}
		</Inset>
	);
}
