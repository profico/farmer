import type { ReactNode } from "react";
import { Platform, Pressable, View } from "react-native";
import Animated from "react-native-reanimated";

import { dayOfMonth, weekdayShort } from "../lib/days";
import { formatHours } from "../lib/duration";
import { Text } from "../ui/components";
import { CORNER, RADIUS } from "../ui/corner";
import { useToggleMorph } from "../ui/press-morph";
import { usePalette } from "../ui/theme";
import { SPACE } from "../ui/type";
import type { DayMark } from "./day-marks";

export type WeekStripProps = {
	days: string[];
	selected: string;
	today: string;
	/** Seconds logged on each day of `days`. */
	totals: Map<string, number>;
	/** The public holidays of the week, by day. */
	holidays?: ReadonlyMap<string, string>;
	/** The mark of each judged day (`day-marks.ts`). */
	marks?: ReadonlyMap<string, DayMark>;
	/** The target of each day (`dayTargets`), for the words of a short day. */
	targets?: ReadonlyMap<string, number>;
	onSelect: (day: string) => void;
};

/**
 * A day of the strip, for Android. It is a toggle button: the corners
 * spring from the rest shape to a larger one when the day is selected, and
 * a press moves them toward the other shape.
 */
function DayChip({
	selected,
	children,
	...press
}: {
	selected: boolean;
	children: ReactNode;
	accessibilityRole: "button";
	accessibilityState: { selected: boolean };
	accessibilityLabel: string;
	onPress: () => void;
}) {
	const palette = usePalette();
	const morph = useToggleMorph(selected, RADIUS.listGroup, CORNER.extraLarge);
	return (
		<Animated.View
			style={[
				{
					flex: 1,
					overflow: "hidden",
					backgroundColor: selected
						? palette.primary
						: palette.surfaceContainer,
				},
				morph.style,
			]}
		>
			<Pressable
				{...press}
				onPressIn={morph.onPressIn}
				onPressOut={morph.onPressOut}
				android_ripple={{ color: palette.outlineVariant, borderless: false }}
				style={{
					alignItems: "center",
					paddingVertical: SPACE.s,
					gap: 2,
				}}
			>
				{children}
			</Pressable>
		</Animated.View>
	);
}

/**
 * The week around the selected day, with what each day holds. A holiday
 * says so, and a working day says when it is done or short, as the strip
 * of the web timesheet does. A day that the rest of the week made up for
 * says nothing.
 */
export function WeekStrip({
	days,
	selected,
	today,
	totals,
	holidays,
	marks,
	targets,
	onSelect,
}: WeekStripProps) {
	const palette = usePalette();
	return (
		<View style={{ flexDirection: "row", gap: SPACE.xs }}>
			{days.map((day) => {
				const isSelected = day === selected;
				const seconds = totals.get(day) ?? 0;
				const holiday = holidays?.get(day);
				const mark = marks?.get(day);
				const note = holiday
					? "Holiday"
					: mark === "done"
						? "Done"
						: mark === "short"
							? "Short"
							: null;
				const spoken = [
					`${weekdayShort(day)} ${dayOfMonth(day)}`,
					`${formatHours(seconds)} logged`,
					holiday ?? null,
					mark === "done" ? "done" : null,
					mark === "short" && targets
						? `${formatHours(Math.max(0, (targets.get(day) ?? 0) - seconds))} short`
						: null,
				]
					.filter((part) => part)
					.join(", ");
				const noteColor = isSelected
					? palette.onPrimary
					: holiday
						? palette.tertiary
						: mark === "short"
							? palette.error
							: palette.primary;
				const content = (
					<>
						<Text
							variant="labelMedium"
							color={isSelected ? palette.onPrimary : palette.onSurfaceVariant}
						>
							{weekdayShort(day)}
						</Text>
						<Text
							variant="titleMedium"
							color={
								isSelected
									? palette.onPrimary
									: day === today
										? palette.primary
										: palette.onSurface
							}
						>
							{dayOfMonth(day)}
						</Text>
						<Text
							variant="bodySmall"
							color={isSelected ? palette.onPrimary : palette.onSurfaceVariant}
							numeric
						>
							{seconds > 0 ? formatHours(seconds) : " "}
						</Text>
						{marks || holidays ? (
							<Text variant="bodySmall" color={noteColor} numberOfLines={1}>
								{note ?? " "}
							</Text>
						) : null}
					</>
				);
				const props = {
					accessibilityRole: "button",
					accessibilityState: { selected: isSelected },
					accessibilityLabel: spoken,
					onPress: () => onSelect(day),
				} as const;
				return Platform.OS === "android" ? (
					<DayChip key={day} selected={isSelected} {...props}>
						{content}
					</DayChip>
				) : (
					<Pressable
						key={day}
						{...props}
						style={{
							flex: 1,
							alignItems: "center",
							paddingVertical: SPACE.s,
							borderRadius: 16,
							gap: 2,
							backgroundColor: isSelected
								? palette.primary
								: palette.surfaceContainer,
						}}
					>
						{content}
					</Pressable>
				);
			})}
		</View>
	);
}
