import type { TimeEntry } from "@farmer/api-client";
import type { UseQueryResult } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Platform, View } from "react-native";
import Reanimated, {
	Easing,
	FadeIn,
	FadeOut,
	LayoutAnimationConfig,
	LinearTransition,
	ReduceMotion,
} from "react-native-reanimated";

import { useAccess } from "../api/capabilities";
import {
	useProjects,
	useStartTimer,
	useTimer,
	useTracking,
} from "../api/queries";
import { useWorkingHours } from "../api/you";
import { formatHours } from "../lib/duration";
import {
	ActionButton,
	EmptyState,
	ErrorBanner,
	ErrorState,
	IconButton,
	Skeleton,
	Text,
} from "../ui/components";
import { messageOf } from "../ui/errors";
import { Figure } from "../ui/figure";
import { useMotionPreference } from "../ui/motion";
import { Inset } from "../ui/screen";
import { usePalette } from "../ui/theme";
import { SPACE } from "../ui/type";
import { dayTargets, weekDayMarks } from "./day-marks";
import { useConfirmDeleteEntry } from "./delete-entry";
import { canContinue, EntryRow } from "./entry-row";
import { EntrySurface } from "./entry-surface";
import { committed } from "./haptics";
import { secondsByDay } from "./seconds";
import { TimerCard } from "./timer-card";
import { WeekStrip } from "./week-strip";

// A row that a save adds or a delete removes. Module scope: a builder made
// in a render costs each render. A fade is a change of opacity, which the
// app allows with less motion on, so the fades ignore the system setting
// and `useMotionPreference` alone decides about the movement.
const ROW_IN = FadeIn.duration(200)
	.easing(Easing.bezier(0.23, 1, 0.32, 1))
	.reduceMotion(ReduceMotion.Never);
const ROW_OUT = FadeOut.duration(150)
	.easing(Easing.bezier(0.23, 1, 0.32, 1))
	.reduceMotion(ReduceMotion.Never);
const ROW_MOVE = LinearTransition.duration(200).easing(
	Easing.bezier(0.77, 0, 0.175, 1),
);

/**
 * One day of the person's own time: the week strip, the timer, and the
 * day's entries. The week is read in one request, which the week grid
 * shares, so moving between its days costs nothing.
 */
export function DayView({
	selected,
	today,
	days,
	entries,
	holidays,
	onSelect,
	onCopyPreviousDay,
	onAssemble,
	copying,
}: {
	selected: string;
	today: string;
	days: string[];
	entries: UseQueryResult<TimeEntry[]>;
	holidays: ReadonlyMap<string, string> | undefined;
	onSelect: (day: string) => void;
	/** Absent when the server cannot copy a day. */
	onCopyPreviousDay?: () => void;
	/** Opens "Assemble my day". Absent when the server cannot do it. */
	onAssemble?: () => void;
	copying: boolean;
}) {
	const palette = usePalette();
	const android = Platform.OS === "android";
	const router = useRouter();
	const { reduceMotion } = useMotionPreference();
	const { fullApi } = useAccess();
	const tracking = useTracking();
	const workingHours = useWorkingHours();
	const timer = useTimer();
	const start = useStartTimer();
	const projects = useProjects();
	const deleteEntry = useConfirmDeleteEntry();
	// An entry names its project without the icon; the project list has it.
	const icons = new Map(
		(projects.data ?? []).map((project) => [project.id, project.icon ?? null]),
	);
	const from = days[0] ?? selected;
	const to = days[6] ?? selected;

	const totals = secondsByDay(entries.data ?? []);
	// A rest-of-day block takes what the day has left, so it is last.
	const dayEntries = (entries.data ?? [])
		.filter((entry) => entry.date === selected)
		.sort((a, b) => Number(a.fillsDay) - Number(b.fillsDay));
	// The marks apply only to a person with a target. Each day is held to
	// the person's working hours, as "Assemble my day" reads them.
	const targets =
		tracking.data && tracking.data.week.targetSeconds != null
			? dayTargets({
					dates: days,
					workingHours: workingHours.data,
					holidays: holidays ?? new Map(),
					fallbackSeconds: tracking.data.daySeconds,
				})
			: undefined;
	const marks = targets
		? weekDayMarks({ dates: days, secondsByDay: totals, targets, today })
		: undefined;
	const holiday = holidays?.get(selected);
	const timerFree = timer.isSuccess && timer.data.timer === null;

	return (
		<>
			<Inset>
				<WeekStrip
					days={days}
					selected={selected}
					today={today}
					totals={totals}
					holidays={fullApi ? holidays : undefined}
					marks={marks}
					targets={targets}
					onSelect={onSelect}
				/>
				{holiday ? (
					<Text variant="bodyMedium" color={palette.tertiary}>
						Public holiday: {holiday}
					</Text>
				) : null}
				<TimerCard />
				{start.error ? (
					<ErrorBanner message={messageOf(start.error) ?? ""} />
				) : null}
				<View
					style={{
						flexDirection: "row",
						alignItems: "center",
						justifyContent: "space-between",
					}}
				>
					<Figure
						text={`${formatHours(totals.get(selected) ?? 0)} logged`}
						value={totals.get(selected) ?? 0}
					/>
					<View style={{ flexDirection: "row", alignItems: "center" }}>
						{onAssemble ? (
							<IconButton
								icon="assistant"
								label="Assemble my day"
								onPress={onAssemble}
							/>
						) : null}
					</View>
				</View>
			</Inset>

			{entries.isPending ? (
				<Inset>
					<Skeleton height={64} />
					<Skeleton height={64} />
				</Inset>
			) : entries.isError ? (
				<ErrorState
					error={entries.error}
					onRetry={() => void entries.refetch()}
				/>
			) : dayEntries.length === 0 ? (
				<EmptyState
					icon="timer"
					title="Nothing logged"
					message="Log time for this day, start the timer, or copy the day before."
					action={
						onCopyPreviousDay ? (
							<ActionButton
								label="Copy the previous day"
								variant="outlined"
								onPress={onCopyPreviousDay}
								disabled={copying}
							/>
						) : undefined
					}
				/>
			) : (
				// A new day shows its rows at once: the key mounts a new list,
				// and the config skips the fades. Only a save or a delete inside
				// the same day animates. The card itself has no layout
				// transition: it moves when the timer card above it changes
				// height, and it must not glide behind the content above it.
				<LayoutAnimationConfig key={selected} skipEntering skipExiting>
					<View
						style={
							android
								? // The Expressive segmented list: 2dp between the rows.
									{ marginHorizontal: SPACE.l, gap: 2 }
								: {
										marginHorizontal: SPACE.l,
										borderRadius: 16,
										overflow: "hidden",
										backgroundColor: palette.surfaceContainer,
									}
						}
					>
						{dayEntries.map((entry, index) => {
							const row = (press?: {
								onPressIn: () => void;
								onPressOut: () => void;
							}) => (
								<EntryRow
									entry={entry}
									projectIcon={
										entry.project ? (icons.get(entry.project.id) ?? null) : null
									}
									onPressIn={press?.onPressIn}
									onPressOut={press?.onPressOut}
									onPress={() =>
										router.push({
											pathname: "/entry",
											params: { id: entry.id, date: entry.date, from, to },
										})
									}
									onDelete={() => deleteEntry.confirm(entry)}
									onContinue={
										timerFree && canContinue(entry)
											? () =>
													start.mutate(
														{ timeEntryId: entry.id },
														{ onSuccess: committed },
													)
											: undefined
									}
								/>
							);
							return (
								<Reanimated.View
									key={entry.id}
									entering={ROW_IN}
									exiting={ROW_OUT}
									layout={reduceMotion ? undefined : ROW_MOVE}
									style={
										android
											? undefined
											: {
													borderTopWidth: index === 0 ? 0 : 1,
													borderTopColor: palette.outlineVariant,
												}
									}
								>
									{android ? (
										<EntrySurface index={index} count={dayEntries.length}>
											{row}
										</EntrySurface>
									) : (
										row()
									)}
								</Reanimated.View>
							);
						})}
					</View>
				</LayoutAnimationConfig>
			)}
		</>
	);
}
