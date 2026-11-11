import { useState } from "react";
import { Pressable, View } from "react-native";

import { ActionButton } from "../ui/action-button";
import { Text } from "../ui/components";
import { Icon } from "../ui/icon";
import { LoadingIndicator } from "../ui/loading";
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
	open = false,
}: {
	traces: ToolTrace[];
	working: boolean;
	/** Start open when settled, so a stored Undo is in view. */
	open?: boolean;
}) {
	const palette = usePalette();
	const [manual, setManual] = useState<boolean | null>(null);
	const expanded = manual ?? (working || open);
	if (traces.length === 0) return null;
	const done = traces.filter((trace) => trace.ok !== null).length;

	return (
		<View style={{ gap: SPACE.xs }}>
			<Pressable
				accessibilityRole="button"
				accessibilityState={{ expanded }}
				onPress={() => setManual((current) => !(current ?? (working || open)))}
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
									<LoadingIndicator
										size={24}
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
								{trace.undo ? (
									trace.undo.done ? (
										<Text variant="bodyMedium" color={palette.onSurfaceVariant}>
											Undone
										</Text>
									) : (
										<ActionButton
											label="Undo"
											variant="text"
											disabled={trace.undo.disabled || trace.undo.busy}
											onPress={trace.undo.onUndo}
										/>
									)
								) : null}
							</View>
						);
					})}
				</View>
			) : null}
		</View>
	);
}
