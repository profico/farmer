import type { TimeEntry } from "@farmer/api-client";
import type { UseQueryResult } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { View } from "react-native";

import { useAccess } from "../api/capabilities";
import { useStartTimer, useTimer, useTracking } from "../api/queries";
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
import { Inset } from "../ui/screen";
import { usePalette } from "../ui/theme";
import { SPACE } from "../ui/type";
import { weekDayMarks } from "./day-marks";
import { canContinue, EntryRow } from "./entry-row";
import { committed } from "./haptics";
import { TimerCard } from "./timer-card";
import { WeekStrip } from "./week-strip";

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
	const router = useRouter();
	const { fullApi } = useAccess();
	const tracking = useTracking();
	const timer = useTimer();
	const start = useStartTimer();
	const from = days[0] ?? selected;
	const to = days[6] ?? selected;

	const totals = new Map<string, number>();
	for (const entry of entries.data ?? []) {
		totals.set(
			entry.date,
			(totals.get(entry.date) ?? 0) + entry.durationSeconds,
		);
	}
	// A rest-of-day block takes what the day has left, so it is last.
	const dayEntries = (entries.data ?? [])
		.filter((entry) => entry.date === selected)
		.sort((a, b) => Number(a.fillsDay) - Number(b.fillsDay));
	const daySeconds = tracking.data?.daySeconds;
	// The marks apply only to a person with a target.
	const marks =
		tracking.data && tracking.data.week.targetSeconds != null && daySeconds
			? weekDayMarks({
					dates: days,
					secondsByDay: totals,
					holidays: holidays ?? new Map(),
					today,
					daySeconds,
				})
			: undefined;
	const holiday = holidays?.get(selected);
	const timerFree = timer.isSuccess && timer.data.timer === null;
	const logTime = () =>
		router.push({ pathname: "/entry", params: { date: selected, from, to } });

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
					daySeconds={daySeconds}
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
						<ActionButton label="Log time" variant="text" onPress={logTime} />
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
				<View
					style={{
						marginHorizontal: SPACE.l,
						borderRadius: 16,
						overflow: "hidden",
						backgroundColor: palette.surfaceContainer,
					}}
				>
					{dayEntries.map((entry, index) => (
						<View
							key={entry.id}
							style={{
								borderTopWidth: index === 0 ? 0 : 1,
								borderTopColor: palette.outlineVariant,
							}}
						>
							<EntryRow
								entry={entry}
								onPress={() =>
									router.push({
										pathname: "/entry",
										params: { id: entry.id, date: entry.date, from, to },
									})
								}
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
						</View>
					))}
				</View>
			)}
		</>
	);
}
