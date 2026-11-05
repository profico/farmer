import type { TimeEntry } from "@farmer/api-client";
import type { UseQueryResult } from "@tanstack/react-query";
import { Platform, Pressable, View } from "react-native";

import { dayOfMonth, weekdayOf } from "../lib/days";
import { formatHours } from "../lib/duration";
import { Card, ErrorState, Skeleton, Text } from "../ui/components";
import { CORNER } from "../ui/corner";
import { Inset } from "../ui/screen";
import { usePalette } from "../ui/theme";
import { SPACE } from "../ui/type";
import {
	daysOfMonth,
	leadingBlanks,
	orderedWeekdays,
	weekdayName,
} from "./calendar";
import { secondsByDay } from "./seconds";

const longDay = (day: string) =>
	new Intl.DateTimeFormat(undefined, {
		weekday: "long",
		day: "numeric",
		month: "long",
		timeZone: "UTC",
	}).format(new Date(`${day}T12:00:00Z`));

/**
 * The month as a calendar: the total of each day, the public holidays and
 * today. A day opens the day view.
 */
export function MonthView({
	month,
	today,
	weekStartsOn,
	entries,
	holidays,
	onOpenDay,
}: {
	month: string;
	today: string;
	weekStartsOn: number;
	entries: UseQueryResult<TimeEntry[]>;
	holidays: ReadonlyMap<string, string> | undefined;
	onOpenDay: (day: string) => void;
}) {
	const palette = usePalette();
	const days = daysOfMonth(month);
	const blanks = leadingBlanks(month, weekStartsOn);
	const totals = secondsByDay(entries.data ?? []);
	const monthTotal = [...totals.values()].reduce(
		(sum, value) => sum + value,
		0,
	);
	const cells: (string | null)[] = [
		...Array.from({ length: blanks }, () => null),
		...days,
	];
	while (cells.length % 7 !== 0) cells.push(null);
	const weeks = Array.from({ length: cells.length / 7 }, (_, i) =>
		cells.slice(i * 7, i * 7 + 7),
	);
	const monthHolidays = days.flatMap((day) => {
		const name = holidays?.get(day);
		return name ? [{ day, name }] : [];
	});

	if (entries.isError) {
		return (
			<ErrorState
				error={entries.error}
				onRetry={() => void entries.refetch()}
			/>
		);
	}

	return (
		<Inset>
			<Card style={{ padding: SPACE.s, gap: SPACE.xs }}>
				<View style={{ flexDirection: "row" }}>
					{orderedWeekdays(weekStartsOn).map((weekday) => (
						<View key={weekday} style={{ flex: 1, alignItems: "center" }}>
							<Text variant="labelMedium" color={palette.onSurfaceVariant}>
								{weekdayName(weekday)}
							</Text>
						</View>
					))}
				</View>
				{weeks.map((week) => (
					<View
						key={week.find((day) => day) ?? "blank"}
						style={{ flexDirection: "row", gap: 2 }}
					>
						{week.map((day, index) => {
							if (!day) {
								return (
									// oxlint-disable-next-line react/no-array-index-key -- a blank cell has no day; its place in the week is its identity
									<View key={`blank-${index}`} style={{ flex: 1 }} />
								);
							}
							const seconds = totals.get(day) ?? 0;
							const holiday = holidays?.get(day);
							const isToday = day === today;
							const weekday = weekdayOf(day);
							const weekend = weekday === 0 || weekday === 6;
							return (
								<Pressable
									key={day}
									accessibilityRole="button"
									accessibilityLabel={[
										longDay(day),
										`${formatHours(seconds)} logged`,
										holiday,
										isToday ? "today" : null,
									]
										.filter((part) => part)
										.join(", ")}
									accessibilityHint="Opens the day"
									onPress={() => onOpenDay(day)}
									android_ripple={{ color: palette.outlineVariant }}
									style={{
										flex: 1,
										minHeight: 52,
										alignItems: "center",
										justifyContent: "center",
										borderRadius:
											Platform.OS === "android" ? CORNER.medium : 10,
										borderWidth: isToday ? 2 : 0,
										borderColor: palette.primary,
										backgroundColor: holiday
											? palette.secondaryContainer
											: weekend
												? palette.surfaceContainerHigh
												: undefined,
									}}
								>
									<Text
										variant="titleSmall"
										color={isToday ? palette.primary : palette.onSurface}
									>
										{dayOfMonth(day)}
									</Text>
									{entries.isPending ? (
										<Text variant="bodySmall" color={palette.onSurfaceVariant}>
											{" "}
										</Text>
									) : (
										<Text
											variant="bodySmall"
											color={
												holiday ? palette.tertiary : palette.onSurfaceVariant
											}
										>
											{seconds > 0
												? formatHours(seconds)
												: holiday
													? "Holiday"
													: " "}
										</Text>
									)}
								</Pressable>
							);
						})}
					</View>
				))}
			</Card>
			{entries.isPending ? (
				<Skeleton height={24} width="40%" />
			) : (
				<Text variant="titleMedium">{formatHours(monthTotal)} logged</Text>
			)}
			{monthHolidays.length > 0 ? (
				<Card>
					<Text variant="titleSmall" color={palette.onSurfaceVariant}>
						Public holidays
					</Text>
					{monthHolidays.map(({ day, name }) => (
						<View
							key={day}
							style={{ flexDirection: "row", justifyContent: "space-between" }}
						>
							<Text variant="bodyMedium">{name}</Text>
							<Text variant="bodyMedium" color={palette.onSurfaceVariant}>
								{longDay(day)}
							</Text>
						</View>
					))}
				</Card>
			) : null}
		</Inset>
	);
}
