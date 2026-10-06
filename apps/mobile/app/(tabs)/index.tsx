import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";

import { useAccess } from "../../src/api/capabilities";
import {
	useEntries,
	useTimer,
	useTracking,
	useUnfiled,
	useWhoami,
} from "../../src/api/queries";
import {
	useCopyDay,
	useCopyWeek,
	useHolidays,
	useHome,
	useSyncNow,
} from "../../src/api/time";
import { addDays, dayTitle, periodTitle, weekOf } from "../../src/lib/days";
import {
	daysOfMonth,
	monthOf,
	monthTitle,
	shiftMonth,
} from "../../src/time/calendar";
import { DateJump } from "../../src/time/components/date-field";
import { MoreMenu } from "../../src/time/components/more-menu";
import { type Notice, Snackbar } from "../../src/time/components/snackbar";
import { TargetsStrip } from "../../src/time/components/targets-strip";
import { UnfiledBanner } from "../../src/time/components/unfiled-banner";
import {
	copyDayBody,
	copyDayMessage,
	copyWeekBody,
	copyWeekMessage,
} from "../../src/time/copy";
import { DAY_PARAM, isDayKey } from "../../src/time/day-link";
import { DayView } from "../../src/time/day-view";
import { committed } from "../../src/time/haptics";
import { MonthView } from "../../src/time/month-view";
import { syncMessage } from "../../src/time/sync";
import { WeekView } from "../../src/time/week-view";
import {
	ActionButton,
	ErrorState,
	IconButton,
	Skeleton,
	Text,
} from "../../src/ui/components";
import { messageOf } from "../../src/ui/errors";
import { Inset, Screen } from "../../src/ui/screen";
import { SegmentedControl } from "../../src/ui/segmented";
import { SPACE } from "../../src/ui/type";

type View3 = "day" | "week" | "month";

const VIEWS: { value: View3; label: string }[] = [
	{ value: "day", label: "Day" },
	{ value: "week", label: "Week" },
	{ value: "month", label: "Month" },
];

/**
 * The Time tab: the person's own time, in the workspace's calendar, as a
 * day, a week of rows or a month. The three views share one day, so a
 * change of view keeps the place.
 */
export default function TimeScreen() {
	const whoami = useWhoami();

	if (whoami.isPending) {
		return (
			<Screen>
				<Inset>
					<Skeleton height={56} width="70%" />
					<Skeleton height={40} />
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
		<Timesheet
			today={whoami.data.today}
			weekStartsOn={whoami.data.weekStartsOn}
			workspaceName={whoami.data.organization.name}
			onRefreshToday={() => void whoami.refetch()}
		/>
	);
}

function Timesheet({
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
	const router = useRouter();
	const { fullApi, dayApi } = useAccess();
	const [view, setView] = useState<View3>("day");
	const [selected, setSelected] = useState(today);
	// A link to a day (the assistant cites days with one) opens that day.
	// The state moves while rendering, so the screen never draws the old day
	// first. The param is then cleared, so the same link opens the day again
	// after the person moves away from it.
	const params = useLocalSearchParams<{ [DAY_PARAM]?: string }>();
	const linkedDay =
		dayApi && isDayKey(params[DAY_PARAM]) ? params[DAY_PARAM] : undefined;
	const [openedDay, setOpenedDay] = useState<string | undefined>(undefined);
	if (linkedDay !== openedDay) {
		setOpenedDay(linkedDay);
		if (linkedDay) {
			setSelected(linkedDay);
			setView("day");
		}
	}
	useEffect(() => {
		if (linkedDay) router.setParams({ [DAY_PARAM]: undefined });
	}, [linkedDay, router]);
	const [notice, setNotice] = useState<Notice | null>(null);
	const hideNotice = useCallback(() => setNotice(null), []);
	const notify = useCallback(
		(message: string, tone: "plain" | "warning" = "plain") =>
			setNotice({ id: Date.now(), message, tone }),
		[],
	);

	const days = weekOf(selected, weekStartsOn);
	const weekFrom = days[0] ?? selected;
	const weekTo = days[6] ?? selected;
	const month = monthOf(selected);
	const monthDays = daysOfMonth(month);
	const monthFrom = monthDays[0] ?? selected;
	const monthTo = monthDays.at(-1) ?? selected;
	const from = view === "month" ? monthFrom : weekFrom;
	const to = view === "month" ? monthTo : weekTo;

	// One read of the range on screen. The day and the week share the key.
	const entries = useEntries(from, to);
	const holidays = useHolidays(from, to);
	const unfiled = useUnfiled(from, to);
	const tracking = useTracking();
	const timer = useTimer();
	const home = useHome(view === "week" && days.includes(today));
	const copyDay = useCopyDay();
	const copyWeek = useCopyWeek();
	const sync = useSyncNow();

	const refresh = () => {
		onRefreshToday();
		void entries.refetch();
		void unfiled.refetch();
		void tracking.refetch();
		void timer.refetch();
		if (view === "week" && days.includes(today)) void home.refetch();
	};

	const copyPreviousDay = () =>
		copyDay.mutate(copyDayBody(selected), {
			onSuccess: (result) => {
				committed();
				notify(copyDayMessage(result));
			},
			onError: (error) => notify(messageOf(error) ?? "", "warning"),
		});
	const copyPreviousWeek = () =>
		copyWeek.mutate(copyWeekBody(weekFrom), {
			onSuccess: (result) => {
				const { message, warning } = copyWeekMessage(result);
				committed();
				notify(message, warning ? "warning" : "plain");
			},
			onError: (error) => notify(messageOf(error) ?? "", "warning"),
		});
	const syncNow = () =>
		sync.mutate(undefined, {
			onSuccess: (result) => {
				const { message, warning } = syncMessage(result);
				notify(message, warning ? "warning" : "plain");
			},
			onError: (error) => notify(messageOf(error) ?? "", "warning"),
		});

	const assembleDay = () =>
		router.push({ pathname: "/time/assemble", params: { date: selected } });

	const step = (direction: 1 | -1) => {
		if (view === "day") setSelected(addDays(selected, direction));
		else if (view === "week") setSelected(addDays(selected, 7 * direction));
		else setSelected(`${shiftMonth(month, direction)}-01`);
	};
	const atNow =
		view === "day"
			? selected === today
			: view === "week"
				? days.includes(today)
				: month === monthOf(today);
	const label =
		view === "day"
			? dayTitle(selected, today)
			: view === "week"
				? periodTitle(weekFrom, weekTo)
				: monthTitle(month);
	const unit = view === "day" ? "day" : view === "week" ? "week" : "month";

	const actions = [
		{ id: "log", title: "Log time" },
		...(fullApi
			? [
					view === "day"
						? {
								id: "copy-day",
								title: "Copy the previous day",
								disabled: copyDay.isPending,
							}
						: view === "week"
							? {
									id: "copy-week",
									title: "Copy the previous week",
									disabled: copyWeek.isPending,
								}
							: null,
					view === "day" && dayApi
						? { id: "assemble", title: "Assemble my day" }
						: null,
					{ id: "time-off", title: "Book time off" },
					{ id: "sync", title: "Sync now", disabled: sync.isPending },
				].flatMap((action) => (action ? [action] : []))
			: []),
	];
	const onAction = (id: string) => {
		switch (id) {
			case "log":
				router.push({
					pathname: "/entry",
					params: { date: selected, from: weekFrom, to: weekTo },
				});
				return;
			case "copy-day":
				copyPreviousDay();
				return;
			case "copy-week":
				copyPreviousWeek();
				return;
			case "assemble":
				assembleDay();
				return;
			case "time-off":
				router.push({ pathname: "/time/time-off", params: { date: selected } });
				return;
			case "sync":
				syncNow();
		}
	};

	return (
		<View style={{ flex: 1 }}>
			<Screen
				overline={workspaceName}
				title="Time"
				refreshing={entries.isRefetching}
				onRefresh={refresh}
				actions={<MoreMenu actions={actions} onAction={onAction} />}
			>
				<Inset>
					<SegmentedControl options={VIEWS} value={view} onChange={setView} />
					<View
						style={{
							flexDirection: "row",
							alignItems: "center",
							gap: SPACE.xs,
						}}
					>
						<IconButton
							icon="back"
							label={`The ${unit} before`}
							onPress={() => step(-1)}
						/>
						<View style={{ flex: 1 }}>
							<Text variant="titleMedium" numberOfLines={1}>
								{label}
							</Text>
						</View>
						{atNow ? null : (
							<ActionButton
								label="Today"
								variant="text"
								onPress={() => setSelected(today)}
							/>
						)}
						<DateJump value={selected} onPick={setSelected} />
						<IconButton
							icon="forward"
							label={`The ${unit} after`}
							onPress={() => step(1)}
						/>
					</View>
					<TargetsStrip />
					<UnfiledBanner
						from={from}
						to={to}
						scope={view === "month" ? "this month" : "this week"}
					/>
				</Inset>
				{view === "day" ? (
					<DayView
						selected={selected}
						today={today}
						days={days}
						entries={entries}
						holidays={holidays.data}
						onSelect={setSelected}
						onCopyPreviousDay={fullApi ? copyPreviousDay : undefined}
						onAssemble={dayApi ? assembleDay : undefined}
						copying={copyDay.isPending}
					/>
				) : view === "week" ? (
					<WeekView
						days={days}
						today={today}
						selected={selected}
						entries={entries}
						holidays={holidays.data}
						onSelect={setSelected}
						onNotify={notify}
						onCopyPreviousWeek={fullApi ? copyPreviousWeek : undefined}
						copying={copyWeek.isPending}
					/>
				) : (
					<MonthView
						month={month}
						today={today}
						weekStartsOn={weekStartsOn}
						entries={entries}
						holidays={holidays.data}
						onOpenDay={(day) => {
							setSelected(day);
							setView("day");
						}}
					/>
				)}
			</Screen>
			<Snackbar notice={notice} onHide={hideNotice} floating />
		</View>
	);
}
