import { useState } from "react";
import { Linking, View } from "react-native";

import { useAccess } from "../../src/api/capabilities";
import { useWhoami, useWorkspace } from "../../src/api/queries";
import { useHolidays } from "../../src/api/you";
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
	SettingsValue,
} from "../../src/ui/settings-list";
import { usePalette } from "../../src/ui/theme";
import { ListSkeleton, YouScreen } from "../../src/you/components/you-screen";
import { dayMonth, weekdayOfKey } from "../../src/you/format";

/**
 * The public holidays of a year, read only. They are left out of every
 * target. An admin turns a day off on the web, because the API has no
 * route for it.
 */
export default function HolidaysScreen() {
	const palette = usePalette();
	const whoami = useWhoami();
	const access = useAccess();
	const { origin, slug } = useWorkspace();
	const today = whoami.data?.today ?? "";
	const currentYear = today ? Number(today.slice(0, 4)) : 0;
	const [chosen, setChosen] = useState<number | null>(null);
	const year = chosen ?? currentYear;
	const holidays = useHolidays(year);

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
				<SettingsSection>
					{holidays.data.map((holiday) => (
						<SettingsValue
							key={holiday.date}
							title={holiday.name}
							subtitle={`${weekdayOfKey(holiday.date)}, ${dayMonth(holiday.date)}`}
							value={holiday.disabled ? "Not observed" : ""}
						/>
					))}
				</SettingsSection>
			)}
			{access.isAdmin ? (
				<SettingsSection footer="Turn off a holiday your company does not observe. You do this in Farmer on the web.">
					<SettingsLink
						icon="web"
						tint="blue"
						title="Change on the web"
						external
						onPress={() =>
							void Linking.openURL(`${origin}/${slug}/settings/holidays`)
						}
					/>
				</SettingsSection>
			) : null}
		</YouScreen>
	);
}
