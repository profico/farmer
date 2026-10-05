import { useTimerSettings, useUpdateTimerSettings } from "../../src/api/you";
import { ErrorBanner, ErrorState } from "../../src/ui/components";
import { messageOf } from "../../src/ui/errors";
import { Inset } from "../../src/ui/screen";
import { SettingsChoice, SettingsSection } from "../../src/ui/settings-list";
import { ListSkeleton, YouScreen } from "../../src/you/components/you-screen";
import { hoursLabel, TIMER_LIMIT_HOURS } from "../../src/you/format";

/**
 * The timer limit: a timer that runs longer is dropped and logs nothing.
 * Farmer never makes a duration from a clock that nobody stopped, so a
 * forgotten timer can never put a wrong entry on a timesheet.
 */
export default function TimerLimitScreen() {
	const settings = useTimerSettings();
	const save = useUpdateTimerSettings();
	const chosen = save.isPending ? save.variables : settings.data?.maxSeconds;

	return (
		<YouScreen title="Drop a timer after">
			{save.error ? (
				<Inset>
					<ErrorBanner message={messageOf(save.error) ?? ""} />
				</Inset>
			) : null}
			{settings.isPending ? (
				<ListSkeleton rows={7} />
			) : settings.isError ? (
				<ErrorState
					error={settings.error}
					onRetry={() => void settings.refetch()}
				/>
			) : (
				<SettingsSection footer="The stopwatch on the Time tab, on the web and in the command-line tool uses this limit.">
					{TIMER_LIMIT_HOURS.map((hours) => {
						const seconds = hours * 3600;
						return (
							<SettingsChoice
								key={hours}
								title={hoursLabel(seconds)}
								selected={chosen === seconds}
								onPress={() => {
									if (seconds !== chosen) save.mutate(seconds);
								}}
							/>
						);
					})}
				</SettingsSection>
			)}
		</YouScreen>
	);
}
