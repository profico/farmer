import { useRouter } from "expo-router";
import { View } from "react-native";

import { useUnfiled } from "../../api/queries";
import { formatHours } from "../../lib/duration";
import { ActionButton, Card, Text } from "../../ui/components";
import { Icon } from "../../ui/icon";
import { usePalette } from "../../ui/theme";
import { SPACE } from "../../ui/type";
import { sumSeconds } from "../seconds";
import { unfiledHeadline } from "../unfiled";

/**
 * The time on screen that has no project: meetings from the calendar,
 * rest-of-day blocks and other time the engines wrote. It counts toward
 * the day but not toward any project report, so the banner stays until
 * the time is filed. It opens the filing screen for the same range.
 */
export function UnfiledBanner({
	from,
	to,
	scope,
}: {
	from: string;
	to: string;
	/** "this week" or "this month". */
	scope: string;
}) {
	const palette = usePalette();
	const router = useRouter();
	const unfiled = useUnfiled(from, to);
	const entries = unfiled.data ?? [];
	if (entries.length === 0) return null;
	const seconds = sumSeconds(entries);
	return (
		<Card tone="secondary">
			<View
				style={{ flexDirection: "row", gap: SPACE.m, alignItems: "center" }}
			>
				<Icon name="inbox" color={palette.onSecondaryContainer} />
				<View style={{ flex: 1 }}>
					<Text variant="titleSmall" color={palette.onSecondaryContainer}>
						{unfiledHeadline(entries.length, scope)}
					</Text>
					<Text variant="bodyMedium" color={palette.onSecondaryContainer}>
						{formatHours(seconds)} is not on a project, so the reports do not
						show it.
					</Text>
				</View>
			</View>
			<View style={{ flexDirection: "row" }}>
				<ActionButton
					label="File them"
					variant="outlined"
					onPress={() =>
						router.push({
							pathname: "/time/unfiled",
							params: { from, to, scope },
						})
					}
				/>
			</View>
		</Card>
	);
}
