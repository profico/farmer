import type { ProjectDetail } from "@farmer/api-client";
import type { ReactNode } from "react";
import { Platform, Pressable, View } from "react-native";

import { formatReportHours, plural } from "../../reports/format";
import { Text } from "../../ui/components";
import { usePalette } from "../../ui/theme";
import { SPACE } from "../../ui/type";
import { projectTitle } from "../model";
import { ProjectMark } from "./project-mark";

/** Whose hours the row sums: the project's, or only the person's own. */
const teamLine = (project: ProjectDetail) =>
	project.stats.scope === "own"
		? "Your time only"
		: project.stats.contributorCount === 0
			? "Nobody on the team"
			: plural(project.stats.contributorCount, "person", "people");

/**
 * One project in the list: its mark, `[CODE] Name`, the team and this
 * month's hours. A member's figures are their own hours (`stats.scope`
 * is `own`), and the row says so.
 */
export function ProjectRow({
	project,
	onPress,
	trailing,
}: {
	project: ProjectDetail;
	onPress: () => void;
	/** A control at the end of the row, such as "Restore". */
	trailing?: ReactNode;
}) {
	const palette = usePalette();
	const archived = project.status === "archived";
	const month = formatReportHours(project.stats.monthSeconds);
	const subtitle = [teamLine(project), archived ? "Archived" : ""]
		.filter((part) => part)
		.join(", ");
	return (
		<View style={{ flexDirection: "row", alignItems: "center" }}>
			<Pressable
				accessible
				accessibilityRole="button"
				accessibilityLabel={`${projectTitle(project)}, ${subtitle}, ${month} hours this month`}
				onPress={onPress}
				android_ripple={{ color: palette.outlineVariant }}
				style={({ pressed }) => ({
					flex: 1,
					flexDirection: "row",
					alignItems: "center",
					gap: SPACE.l,
					minHeight: 64,
					paddingHorizontal: SPACE.l,
					paddingVertical: SPACE.s,
					opacity: Platform.OS === "ios" && pressed ? 0.6 : archived ? 0.7 : 1,
				})}
			>
				<ProjectMark icon={project.icon} name={project.name} />
				<View style={{ flex: 1 }}>
					<Text variant="bodyLarge" numberOfLines={2}>
						{projectTitle(project)}
					</Text>
					<Text variant="bodySmall" color={palette.onSurfaceVariant}>
						{subtitle}
					</Text>
				</View>
				<View style={{ alignItems: "flex-end" }}>
					<Text variant="titleSmall">{month}</Text>
					<Text variant="labelMedium" color={palette.onSurfaceVariant}>
						this month
					</Text>
				</View>
			</Pressable>
			{trailing ? (
				<View style={{ paddingRight: SPACE.s }}>{trailing}</View>
			) : null}
		</View>
	);
}
