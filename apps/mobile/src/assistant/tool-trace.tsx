import { useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";

import { Text } from "../ui/components";
import { Icon } from "../ui/icon";
import { usePalette } from "../ui/theme";
import { SPACE } from "../ui/type";
import { toolDetail, toolLabel } from "./tool-labels";
import type { ToolTrace } from "./turn";

/**
 * The tools of the turn in flight: open while the turn works, and one line
 * ("Used 3 tools") after it. Each row names the step and what it was about.
 */
export function ToolTraceList({
	traces,
	working,
}: {
	traces: ToolTrace[];
	working: boolean;
}) {
	const palette = usePalette();
	const [manual, setManual] = useState<boolean | null>(null);
	const expanded = manual ?? working;
	if (traces.length === 0) return null;
	const done = traces.filter((trace) => trace.ok !== null).length;

	return (
		<View style={{ gap: SPACE.xs }}>
			<Pressable
				accessibilityRole="button"
				accessibilityState={{ expanded }}
				onPress={() => setManual((current) => !(current ?? working))}
				hitSlop={8}
				style={{ flexDirection: "row", alignItems: "center", gap: SPACE.s }}
			>
				<Icon name="assistant" size={16} color={palette.onSurfaceVariant} />
				<Text variant="labelLarge" color={palette.onSurfaceVariant}>
					{working
						? "Working"
						: done === 1
							? "Used 1 tool"
							: `Used ${done} tools`}
				</Text>
				<Icon
					name={expanded ? "minus" : "add"}
					size={16}
					color={palette.onSurfaceVariant}
				/>
			</Pressable>
			{expanded ? (
				<View
					style={{
						marginLeft: 7,
						paddingLeft: SPACE.m,
						borderLeftWidth: 1,
						borderLeftColor: palette.outlineVariant,
						gap: SPACE.xs,
					}}
				>
					{traces.map((trace) => {
						const detail = toolDetail(trace.arguments);
						return (
							<View
								key={trace.toolCallId}
								accessible
								accessibilityLabel={[
									toolLabel(trace.name),
									detail,
									trace.ok === null ? "running" : trace.ok ? "done" : "failed",
								]
									.filter((part) => part)
									.join(", ")}
								style={{
									flexDirection: "row",
									alignItems: "center",
									gap: SPACE.s,
									minHeight: 24,
								}}
							>
								{trace.ok === null ? (
									<ActivityIndicator
										size="small"
										color={palette.onSurfaceVariant}
									/>
								) : (
									<Icon
										name={trace.ok ? "check" : "close"}
										size={16}
										color={trace.ok ? palette.onSurfaceVariant : palette.error}
									/>
								)}
								<Text variant="bodyMedium" numberOfLines={1}>
									{toolLabel(trace.name)}
								</Text>
								{detail ? (
									<View style={{ flex: 1 }}>
										<Text
											variant="bodyMedium"
											color={palette.onSurfaceVariant}
											numberOfLines={1}
										>
											{detail}
										</Text>
									</View>
								) : null}
							</View>
						);
					})}
				</View>
			) : null}
		</View>
	);
}
