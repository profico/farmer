import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { useAccess } from "../../src/api/capabilities";
import { useWhoami } from "../../src/api/queries";
import { useHolidays, useSetHolidayDisabled } from "../../src/api/you";
import {
	EmptyState,
	ErrorState,
	IconButton,
	Text,
} from "../../src/ui/components";
import { Inset } from "../../src/ui/screen";
import {
	SettingsLink,
	SettingsSection,
	SettingsSwitch,
	SettingsValue,
} from "../../src/ui/settings-list";
import { usePalette } from "../../src/ui/theme";
import { notifyError } from "../../src/workspace/components";
import { ListSkeleton, YouScreen } from "../../src/you/components/you-screen";
import { dayMonth, weekdayOfKey } from "../../src/you/format";

/**
 * The public holidays of a year. They are left out of every target. An
 * admin turns off a holiday that the company does not observe with the
 * switch of its row, as on the web.
 */
export default function HolidaysScreen() {
	const palette = usePalette();
	const whoami = useWhoami();
	const access = useAccess();
	const router = useRouter();
	const today = whoami.data?.today ?? "";
	const currentYear = today ? Number(today.slice(0, 4)) : 0;
	const [chosen, setChosen] = useState<number | null>(null);
	const year = chosen ?? currentYear;
	const holidays = useHolidays(year);
	const toggle = useSetHolidayDisabled(year);
	const canSwitch = access.isAdmin;

	return (
		<YouScreen
			title="Holidays"
			refreshing={holidays.isRefetching}
			onRefresh={() => void holidays.refetch()}
		>
			<Inset>
				<Text variant="bodyMedium" color={palette.onSurfaceVariant}>
					Public holidays for this organization's country. They are left out of
					every target: a working day is Monday to Friday minus these.
					{canSwitch
						? " Turn off a holiday that your company does not observe."
						: ""}
				</Text>
				{year ? (
					<View
						style={{
							flexDirection: "row",
							alignItems: "center",
							justifyContent: "center",
						}}
					>
						<IconButton
							icon="back"
							label="Previous year"
							onPress={() => setChosen(year - 1)}
						/>
						<View
							accessible
							accessibilityRole="header"
							style={{ minWidth: 96, alignItems: "center" }}
						>
							<Text variant="headlineSmall">{String(year)}</Text>
						</View>
						<IconButton
							icon="forward"
							label="Next year"
							onPress={() => setChosen(year + 1)}
						/>
					</View>
				) : null}
			</Inset>
			{whoami.isPending || holidays.isPending ? (
				<ListSkeleton rows={6} />
			) : whoami.isError ? (
				<ErrorState
					error={whoami.error}
					onRetry={() => void whoami.refetch()}
				/>
			) : holidays.isError ? (
				<ErrorState
					error={holidays.error}
					onRetry={() => void holidays.refetch()}
				/>
			) : holidays.data.length === 0 ? (
				<EmptyState
					icon="holiday"
					title="No holidays"
					message="No public holidays found for this country and year."
				/>
			) : (
				<SettingsSection
					footer={
						canSwitch
							? "A holiday that is turned off is a working day in this organization."
							: undefined
					}
				>
					{holidays.data.map((holiday) => {
						const when = `${weekdayOfKey(holiday.date)}, ${dayMonth(holiday.date)}`;
						return canSwitch ? (
							<SettingsSwitch
								key={holiday.date}
								title={holiday.name}
								subtitle={holiday.disabled ? `${when}. Not observed` : when}
								value={!holiday.disabled}
								onValueChange={(observed) =>
									toggle.mutate(
										{ name: holiday.name, disabled: !observed },
										{
											onError: (error) =>
												notifyError("Could not update the holiday", error),
										},
									)
								}
							/>
						) : (
							<SettingsValue
								key={holiday.date}
								title={holiday.name}
								subtitle={when}
								value={holiday.disabled ? "Not observed" : ""}
							/>
						);
					})}
				</SettingsSection>
			)}
			<SettingsSection
				title="Related"
				footer="A holiday is not a working day in your schedule. Time off you book yourself is under Absences."
			>
				<SettingsLink
					icon="schedule"
					tint="blue"
					title="My schedule"
					onPress={() => router.push("/you/schedule")}
				/>
				<SettingsLink
					icon="absence"
					tint="red"
					title="Absences"
					onPress={() => router.push("/you/absences")}
				/>
			</SettingsSection>
		</YouScreen>
	);
}
