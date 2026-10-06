import type { TimeEntry } from "@farmer/api-client";
import { Platform, Pressable, View } from "react-native";

import { useAccess } from "../api/capabilities";
import { formatHours } from "../lib/duration";
import { ProjectMark } from "../projects/components/project-mark";
import { IconButton, Text } from "../ui/components";
import { useRowMenu } from "../ui/row-menu";
import { usePalette } from "../ui/theme";
import { SPACE } from "../ui/type";

/** Whether an entry can be continued by the stopwatch. A work-time block is
 *  recomputed from the day, and time off is not measured (as the CLI's
 *  `whyNotContinued` says). */
export const canContinue = (entry: TimeEntry) =>
	!entry.fillsDay && !entry.task.isAbsence;

/**
 * The mark at the head of an entry: its project's mark, as the web draws
 * it. An entry with no project (time off, a meeting not filed yet) has a
 * dot in the same square, so the rows keep one text edge.
 */
function EntryMark({
	project,
	icon,
}: {
	project: TimeEntry["project"];
	icon: string | null;
}) {
	const palette = usePalette();
	if (project) return <ProjectMark icon={icon} name={project.name} />;
	return (
		<View
			style={{
				width: 36,
				height: 36,
				borderRadius: Platform.OS === "ios" ? 9 : 11,
				borderCurve: "continuous",
				alignItems: "center",
				justifyContent: "center",
				backgroundColor: palette.surfaceContainerHigh,
			}}
		>
			<View
				style={{
					width: 8,
					height: 8,
					borderRadius: 4,
					backgroundColor: palette.onSurfaceVariant,
				}}
			/>
		</View>
	);
}

export function EntryRow({
	entry,
	projectIcon = null,
	onPress,
	onContinue,
	onDelete,
}: {
	entry: TimeEntry;
	/** The icon of the entry's project, from the project list. An entry
	 *  does not carry it. */
	projectIcon?: string | null;
	onPress: () => void;
	/** Absent when the entry cannot be continued, or a timer runs. */
	onContinue?: () => void;
	/** Asks to delete the entry. Absent when the row may not delete. */
	onDelete?: () => void;
}) {
	const palette = usePalette();
	const { dayApi } = useAccess();
	// The meeting sync changed the entry, and the person did not answer yet.
	// The edit sheet shows what changed.
	const changed = dayApi && Boolean(entry.calendarChange);
	const project = entry.project;
	const detail = [project?.client.name, entry.task.name]
		.filter(Boolean)
		.join(" · ");
	const title =
		project?.name ?? (entry.task.isAbsence ? "Time off" : "No project");
	// A long press opens Edit and Delete, the actions of the edit sheet.
	const menu = useRowMenu(title, [
		{ label: "Edit", icon: "edit", onPress },
		onDelete && {
			label: "Delete",
			icon: "delete",
			destructive: true,
			onPress: onDelete,
		},
	]);
	return (
		<Pressable
			onLongPress={menu.onLongPress}
			accessibilityRole="button"
			accessibilityLabel={[
				title,
				detail,
				changed ? "updated automatically by your calendar" : "",
				entry.description,
				formatHours(entry.durationSeconds),
			]
				.filter((part) => part)
				.join(", ")}
			accessibilityHint="Edit the entry"
			// The row is one element for a screen reader, so the continue button
			// inside it is offered as an action of the row.
			accessibilityActions={[
				...(onContinue
					? [{ name: "continue", label: "Continue this entry with the timer" }]
					: []),
				...(menu.accessibilityActions ?? []),
			]}
			onAccessibilityAction={(event) => {
				if (event.nativeEvent.actionName === "continue") onContinue?.();
				else menu.onAccessibilityAction?.(event);
			}}
			onPress={onPress}
			android_ripple={{ color: palette.outlineVariant }}
			style={({ pressed }) => ({
				flexDirection: "row",
				alignItems: "center",
				gap: SPACE.m,
				paddingHorizontal: SPACE.l,
				paddingVertical: SPACE.m,
				backgroundColor:
					Platform.OS === "ios" && pressed
						? palette.surfaceContainerHigh
						: undefined,
			})}
		>
			<EntryMark project={project} icon={projectIcon} />
			<View style={{ flex: 1, gap: 2 }}>
				<Text variant="titleMedium" numberOfLines={1}>
					{title}
				</Text>
				<Text
					variant="bodyMedium"
					color={palette.onSurfaceVariant}
					numberOfLines={1}
				>
					{detail}
					{entry.fillsDay ? " · Rest of the day" : ""}
					{entry.synced ? " · Calendar" : ""}
					{changed ? " · Updated automatically" : ""}
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
			<Text variant="titleMedium" numeric>
				{formatHours(entry.durationSeconds)}
			</Text>
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
