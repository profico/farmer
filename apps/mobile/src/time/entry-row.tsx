import type { TimeEntry } from "@farmer/api-client";
import { Platform, Pressable, View } from "react-native";

import { formatHours } from "../lib/duration";
import { IconButton, Text } from "../ui/components";
import { usePalette } from "../ui/theme";
import { SPACE } from "../ui/type";

/** Whether an entry can be continued by the stopwatch. A work-time block is
 *  recomputed from the day, and time off is not measured (as the CLI's
 *  `whyNotContinued` says). */
export const canContinue = (entry: TimeEntry) =>
	!entry.fillsDay && !entry.task.isAbsence;

export function EntryRow({
	entry,
	onPress,
	onContinue,
}: {
	entry: TimeEntry;
	onPress: () => void;
	/** Absent when the entry cannot be continued, or a timer runs. */
	onContinue?: () => void;
}) {
	const palette = usePalette();
	const project = entry.project;
	const detail = [project?.client.name, entry.task.name]
		.filter(Boolean)
		.join(" · ");
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityHint="Edit the entry"
			onPress={onPress}
			android_ripple={{ color: palette.outlineVariant }}
			style={({ pressed }) => ({
				flexDirection: "row",
				alignItems: "center",
				gap: SPACE.m,
				paddingHorizontal: SPACE.l,
				paddingVertical: SPACE.m,
				opacity: Platform.OS === "ios" && pressed ? 0.6 : 1,
			})}
		>
			<View style={{ flex: 1, gap: 2 }}>
				<Text variant="titleMedium" numberOfLines={1}>
					{project?.name ?? (entry.task.isAbsence ? "Time off" : "No project")}
				</Text>
				<Text
					variant="bodyMedium"
					color={palette.onSurfaceVariant}
					numberOfLines={1}
				>
					{detail}
					{entry.fillsDay ? " · Rest of the day" : ""}
					{entry.synced ? " · Calendar" : ""}
				</Text>
				{entry.description ? (
					<Text
						variant="bodyMedium"
						color={palette.onSurfaceVariant}
						numberOfLines={2}
					>
						{entry.description}
					</Text>
				) : null}
			</View>
			<Text variant="titleMedium">{formatHours(entry.durationSeconds)}</Text>
			{onContinue ? (
				<IconButton
					icon="play"
					label="Continue this entry with the timer"
					onPress={onContinue}
				/>
			) : null}
		</Pressable>
	);
}
