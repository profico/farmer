import type { WorkingHoursDay } from "@farmer/api-client";
import { useRouter } from "expo-router";

import { useWhoami } from "../../src/api/queries";
import { useTimerSettings } from "../../src/api/time";
import { useUpdateWorkingHoursDay, useWorkingHours } from "../../src/api/you";
import { ErrorBanner, ErrorState } from "../../src/ui/components";
import { messageOf } from "../../src/ui/errors";
import { Inset } from "../../src/ui/screen";
import {
	SettingsLink,
	SettingsSection,
	SettingsSwitch,
} from "../../src/ui/settings-list";
import { TimeSetting } from "../../src/you/components/pickers";
import { ListSkeleton, YouScreen } from "../../src/you/components/you-screen";
import {
	daySeconds,
	hoursLabel,
	orderedWeekdays,
	weekdayName,
} from "../../src/you/format";

const DEFAULT_START = "09:00";
const DEFAULT_END = "17:00";

/**
 * The person's working hours and the timer limit. The hours drive the
 * block that fills the rest of a day, a span of time off and when a
 * reminder arrives. The targets come from the hour fund, not from here.
 */
export default function ScheduleScreen() {
	const router = useRouter();
	const whoami = useWhoami();
	const days = useWorkingHours();
	const timer = useTimerSettings();
	const update = useUpdateWorkingHoursDay();

	const refresh = () => {
		void days.refetch();
		void timer.refetch();
	};

	const save = (
		day: WorkingHoursDay,
		change: { enabled?: boolean; startTime?: string; endTime?: string },
	) =>
		update.mutate({
			dayOfWeek: day.dayOfWeek,
			enabled: change.enabled ?? day.enabled,
			startTime: change.startTime ?? day.startTime ?? DEFAULT_START,
			endTime: change.endTime ?? day.endTime ?? DEFAULT_END,
		});

	const weekStartsOn = whoami.data?.weekStartsOn ?? 1;
	const byDay = new Map(days.data?.map((day) => [day.dayOfWeek, day]));
	const ordered = orderedWeekdays(weekStartsOn).flatMap((dayOfWeek) => {
		const day = byDay.get(dayOfWeek);
		return day ? [day] : [];
	});

	return (
		<YouScreen
			title="Schedule"
			refreshing={days.isRefetching}
			onRefresh={refresh}
		>
			{update.error ? (
				<Inset>
					<ErrorBanner message={messageOf(update.error) ?? ""} />
				</Inset>
			) : null}
			{days.isPending ? (
				<ListSkeleton rows={7} />
			) : days.isError ? (
				<ErrorState error={days.error} onRetry={() => void days.refetch()} />
			) : (
				ordered.map((day) => {
					const start = day.startTime ?? DEFAULT_START;
					const end = day.endTime ?? DEFAULT_END;
					const name = weekdayName(day.dayOfWeek);
					const seconds = daySeconds(start, end);
					return (
						<SettingsSection key={day.dayOfWeek}>
							<SettingsSwitch
								title={name}
								subtitle={
									day.enabled
										? end > start
											? hoursLabel(seconds)
											: "The end is before the start"
										: "Day off"
								}
								value={day.enabled}
								onValueChange={(enabled) => save(day, { enabled })}
							/>
							{day.enabled ? (
								<TimeSetting
									title="Starts"
									value={start}
									onChange={(startTime) => save(day, { startTime })}
								/>
							) : null}
							{day.enabled ? (
								<TimeSetting
									title="Ends"
									value={end}
									onChange={(endTime) => save(day, { endTime })}
								/>
							) : null}
						</SettingsSection>
					);
				})
			)}
			<SettingsSection
				title="Timer"
				footer="A timer that runs longer than this is dropped, and logs nothing. You are told where you work, so you can put the time in by hand."
			>
				<SettingsLink
					icon="timer"
					tint="orange"
					title="Drop a timer after"
					value={
						timer.data
							? hoursLabel(timer.data.maxSeconds)
							: timer.isError
								? "Not available"
								: ""
					}
					onPress={() => router.push("/you/timer-limit")}
				/>
			</SettingsSection>
			<SettingsSection footer="Blocks, such as a daily break or a standing meeting, that go on your timesheet without you logging them.">
				<SettingsLink
					icon="repeat"
					tint="indigo"
					title="Recurring blocks"
					onPress={() => router.push("/you/recurring-blocks")}
				/>
			</SettingsSection>
		</YouScreen>
	);
}
