import { useRouter } from "expo-router";
import { useState } from "react";
import { Linking, View } from "react-native";

import {
	useEntries,
	useStartTimer,
	useTimer,
	useUnfiled,
	useWhoami,
	useWorkspace,
} from "../../src/api/queries";
import { addDays, dayTitle, weekOf } from "../../src/lib/days";
import { formatHours } from "../../src/lib/duration";
import { canContinue, EntryRow } from "../../src/time/entry-row";
import { TimerCard } from "../../src/time/timer-card";
import { WeekStrip } from "../../src/time/week-strip";
import {
	ActionButton,
	Card,
	EmptyState,
	ErrorBanner,
	ErrorState,
	IconButton,
	Skeleton,
	Text,
} from "../../src/ui/components";
import { messageOf } from "../../src/ui/errors";
import { Icon } from "../../src/ui/icon";
import { Inset, Screen } from "../../src/ui/screen";
import { usePalette } from "../../src/ui/theme";
import { SPACE } from "../../src/ui/type";

/**
 * The Time tab: one day of the person's own time, in the workspace's
 * calendar. The week around it is read in one request, so moving between
 * its days costs nothing.
 */
export default function TimeScreen() {
	const whoami = useWhoami();

	if (whoami.isPending) {
		return (
			<Screen>
				<Inset>
					<Skeleton height={56} width="70%" />
					<Skeleton height={72} />
					<Skeleton height={132} radius={16} />
				</Inset>
			</Screen>
		);
	}
	if (whoami.isError) {
		return (
			<Screen title="Time">
				<ErrorState
					error={whoami.error}
					onRetry={() => void whoami.refetch()}
				/>
			</Screen>
		);
	}
	return (
		<Day
			today={whoami.data.today}
			weekStartsOn={whoami.data.weekStartsOn}
			workspaceName={whoami.data.organization.name}
			onRefreshToday={() => void whoami.refetch()}
		/>
	);
}

function Day({
	today,
	weekStartsOn,
	workspaceName,
	onRefreshToday,
}: {
	today: string;
	weekStartsOn: number;
	workspaceName: string;
	onRefreshToday: () => void;
}) {
	const palette = usePalette();
	const router = useRouter();
	const { origin } = useWorkspace();
	const [selected, setSelected] = useState(today);
	const days = weekOf(selected, weekStartsOn);
	const from = days[0] ?? selected;
	const to = days[6] ?? selected;
	const entries = useEntries(from, to);
	const unfiled = useUnfiled(from, to);
	const timer = useTimer();
	const start = useStartTimer();

	const totals = new Map<string, number>();
	for (const entry of entries.data ?? []) {
		totals.set(
			entry.date,
			(totals.get(entry.date) ?? 0) + entry.durationSeconds,
		);
	}
	const dayEntries = (entries.data ?? []).filter(
		(entry) => entry.date === selected,
	);
	const timerFree = timer.isSuccess && timer.data.timer === null;
	const unfiledCount = unfiled.data?.length ?? 0;

	const refresh = () => {
		onRefreshToday();
		void entries.refetch();
		void unfiled.refetch();
		void timer.refetch();
	};

	return (
		<Screen
			overline={workspaceName}
			title={dayTitle(selected, today)}
			refreshing={entries.isRefetching}
			onRefresh={refresh}
			actions={
				<View style={{ flexDirection: "row" }}>
					<IconButton
						icon="back"
						label="The day before"
						onPress={() => setSelected(addDays(selected, -1))}
					/>
					<IconButton
						icon="calendar"
						label="Today"
						disabled={selected === today}
						onPress={() => setSelected(today)}
					/>
					<IconButton
						icon="forward"
						label="The day after"
						onPress={() => setSelected(addDays(selected, 1))}
					/>
				</View>
			}
		>
			<Inset>
				<WeekStrip
					days={days}
					selected={selected}
					today={today}
					totals={totals}
					onSelect={setSelected}
				/>
				<TimerCard />
				{start.error ? (
					<ErrorBanner message={messageOf(start.error) ?? ""} />
				) : null}
				{unfiledCount > 0 ? (
					<Card>
						<View
							style={{
								flexDirection: "row",
								gap: SPACE.m,
								alignItems: "center",
							}}
						>
							<Icon name="inbox" color={palette.onSurfaceVariant} />
							<View style={{ flex: 1 }}>
								<Text variant="bodyMedium">
									{unfiledCount === 1
										? "1 entry this week has no project yet."
										: `${unfiledCount} entries this week have no project yet.`}
								</Text>
							</View>
							<IconButton
								icon="web"
								label="File them in Farmer on the web"
								onPress={() => void Linking.openURL(origin)}
							/>
						</View>
					</Card>
				) : null}
				<View
					style={{
						flexDirection: "row",
						alignItems: "center",
						justifyContent: "space-between",
					}}
				>
					<Text variant="titleMedium">
						{formatHours(totals.get(selected) ?? 0)} logged
					</Text>
					<ActionButton
						label="Log time"
						variant="text"
						onPress={() =>
							router.push({ pathname: "/entry", params: { date: selected } })
						}
					/>
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
					message="Log time for this day, or start the timer."
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
										? () => start.mutate({ timeEntryId: entry.id })
										: undefined
								}
							/>
						</View>
					))}
				</View>
			)}
		</Screen>
	);
}
