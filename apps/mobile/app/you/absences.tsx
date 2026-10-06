import type { AbsenceEntry } from "@farmer/api-client";
import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { useWhoami } from "../../src/api/queries";
import { useAbsences, useDeleteAbsence } from "../../src/api/you";
import { formatHours } from "../../src/lib/duration";
import {
	EmptyState,
	ErrorBanner,
	ErrorState,
	IconButton,
	Text,
} from "../../src/ui/components";
import { showDialog } from "../../src/ui/dialog";
import { messageOf } from "../../src/ui/errors";
import { Inset } from "../../src/ui/screen";
import {
	SettingsLink,
	SettingsSection,
	SettingsValue,
} from "../../src/ui/settings-list";
import { ListSkeleton, YouScreen } from "../../src/you/components/you-screen";
import {
	dayMonth,
	monthTitle,
	shiftMonth,
	weekdayOfKey,
} from "../../src/you/format";

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The person's own time off, one month at a time. A press on a day
 * deletes it. "Add" books a span of days: the server books each working
 * day at the person's own hours.
 */
export default function AbsencesScreen() {
	const router = useRouter();
	const whoami = useWhoami();
	const today = whoami.data?.today ?? "";
	const [moved, setMoved] = useState(0);
	const base = today
		? { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) }
		: null;
	const { year, month } = base
		? shiftMonth(base.year, base.month, moved)
		: { year: 0, month: 0 };
	const absences = useAbsences(year, month);
	const remove = useDeleteAbsence();

	// The span opens on today in this month, else on the first of the month.
	const startOfMonth = `${year}-${pad(month)}-01`;
	const openOn =
		today.slice(0, 7) === startOfMonth.slice(0, 7) ? today : startOfMonth;

	const confirmDelete = (entry: AbsenceEntry) =>
		showDialog(
			"Delete this time off?",
			`${entry.task.name} on ${weekdayOfKey(entry.date)}, ${dayMonth(entry.date)}.`,
			[
				{ text: "Cancel", style: "cancel" },
				{
					text: "Delete",
					style: "destructive",
					onPress: () => remove.mutate(entry.id),
				},
			],
		);

	return (
		<YouScreen
			title="Absences"
			action={{
				icon: "add",
				label: "Book time off",
				onPress: () =>
					router.push({ pathname: "/you/absence", params: { date: openOn } }),
			}}
			refreshing={absences.isRefetching}
			onRefresh={() => void absences.refetch()}
		>
			{base ? (
				<Inset>
					<View
						style={{
							flexDirection: "row",
							alignItems: "center",
							justifyContent: "center",
						}}
					>
						<IconButton
							icon="back"
							label="Previous month"
							onPress={() => setMoved(moved - 1)}
						/>
						<View
							accessible
							accessibilityRole="header"
							style={{ minWidth: 180, alignItems: "center" }}
						>
							<Text variant="titleLarge">{monthTitle(year, month)}</Text>
						</View>
						<IconButton
							icon="forward"
							label="Next month"
							onPress={() => setMoved(moved + 1)}
						/>
					</View>
				</Inset>
			) : null}
			{remove.error ? (
				<Inset>
					<ErrorBanner message={messageOf(remove.error) ?? ""} />
				</Inset>
			) : null}
			{whoami.isError ? (
				<ErrorState
					error={whoami.error}
					onRetry={() => void whoami.refetch()}
				/>
			) : !base || absences.isPending ? (
				<ListSkeleton rows={3} />
			) : absences.isError ? (
				<ErrorState
					error={absences.error}
					onRetry={() => void absences.refetch()}
				/>
			) : absences.data.length === 0 ? (
				<EmptyState
					icon="absence"
					title="No time off"
					message={`You have no time off in ${monthTitle(year, month)}.`}
				/>
			) : (
				<SettingsSection footer="Press a day, or hold it, to delete it.">
					{absences.data.map((entry) => (
						<SettingsValue
							key={entry.id}
							title={entry.task.name}
							subtitle={[
								`${weekdayOfKey(entry.date)}, ${dayMonth(entry.date)}`,
								entry.description,
							]
								.filter((part) => part)
								.join(", ")}
							value={formatHours(entry.durationSeconds)}
							actions={[
								!remove.isPending && {
									label: "Delete",
									icon: "delete",
									destructive: true,
									onPress: () => confirmDelete(entry),
								},
							]}
							onPress={
								remove.isPending ? undefined : () => confirmDelete(entry)
							}
						/>
					))}
				</SettingsSection>
			)}
			<SettingsSection
				title="Related"
				footer="Your schedule leaves days of time off out of your target."
			>
				<SettingsLink
					icon="schedule"
					tint="blue"
					title="My schedule"
					onPress={() => router.push("/you/schedule")}
				/>
				<SettingsLink
					icon="holiday"
					tint="orange"
					title="Holidays"
					onPress={() => router.push("/you/holidays")}
				/>
			</SettingsSection>
		</YouScreen>
	);
}
