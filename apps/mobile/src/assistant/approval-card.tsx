import { useState } from "react";
import { Platform, Pressable, ScrollView, View } from "react-native";

import { ActionButton, Card, Text } from "../ui/components";
import { Icon } from "../ui/icon";
import { usePalette } from "../ui/theme";
import { SPACE } from "../ui/type";
import type { PendingApproval } from "./turn";

/** The arguments, indented, or the raw text when the model sent bad JSON. */
const formatArgs = (raw: string) => {
	try {
		return JSON.stringify(JSON.parse(raw || "{}"), null, 2);
	} catch {
		return raw;
	}
};

/**
 * The one gate between a write that the model asks for and the write. The
 * summary comes from the server and says what happens ("Log 2.00h on
 * 2026-03-03"). A batch shows its rows, each with a check box, all on at
 * the start. A row that is off is left out of the write.
 */
export function ApprovalCard({
	pending,
	busy,
	onDecide,
}: {
	pending: PendingApproval;
	busy: boolean;
	onDecide: (
		decision: "approved" | "rejected",
		selectedRowIds?: string[],
	) => void;
}) {
	const palette = usePalette();
	const [showArgs, setShowArgs] = useState(false);
	const rows = pending.preview?.rows ?? [];
	const selectable = pending.selectable && rows.length > 0;
	const [excluded, setExcluded] = useState<Set<string>>(() => new Set());
	// A new batch starts with every row on again. Keyed on the call, so a
	// render cannot turn on a row that the person turned off.
	const [armedFor, setArmedFor] = useState(pending.toolCallId);
	if (armedFor !== pending.toolCallId) {
		setArmedFor(pending.toolCallId);
		setExcluded(new Set());
	}

	const selected = rows.map((row) => row.id).filter((id) => !excluded.has(id));
	const toggle = (id: string) =>
		setExcluded((current) => {
			const next = new Set(current);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	// Rows past the preview's limit are not on the card and go with the
	// approval; the note says so.
	const hasHiddenRows = Boolean(pending.preview?.note);
	const unticked = rows.length - selected.length;
	const approveLabel =
		!selectable || unticked === 0
			? "Approve"
			: hasHiddenRows
				? `Approve all but ${unticked}`
				: `Approve ${selected.length}`;

	return (
		<Card tone="secondary">
			<Text variant="labelMedium" color={palette.onSecondaryContainer}>
				Needs your approval
			</Text>
			<Text variant="titleMedium" color={palette.onSecondaryContainer}>
				{pending.summary}
			</Text>

			{pending.preview && rows.length > 0 ? (
				<View
					style={{
						borderRadius: 10,
						backgroundColor: palette.surface,
						overflow: "hidden",
					}}
				>
					<ScrollView horizontal showsHorizontalScrollIndicator={false}>
						<View>
							<View style={{ flexDirection: "row", paddingVertical: SPACE.s }}>
								{selectable ? <View style={{ width: 44 }} /> : null}
								{pending.preview.columns.map((column) => (
									<View
										key={column}
										style={{ width: 120, paddingHorizontal: SPACE.s }}
									>
										<Text
											variant="labelMedium"
											color={palette.onSurfaceVariant}
										>
											{column}
										</Text>
									</View>
								))}
							</View>
							{rows.map((row) => {
								const on = !excluded.has(row.id);
								const label = row.cells.join(", ");
								const cells = row.cells.map((cell, index) => (
									<View
										// oxlint-disable-next-line react/no-array-index-key -- the columns have a fixed order, so the position is the column
										key={index}
										style={{
											width: index === row.cells.length - 1 ? 200 : 120,
											paddingHorizontal: SPACE.s,
										}}
									>
										<Text
											variant="bodyMedium"
											color={
												index === 0
													? palette.onSurface
													: palette.onSurfaceVariant
											}
										>
											{cell}
										</Text>
									</View>
								));
								return selectable ? (
									<Pressable
										key={row.id}
										accessibilityRole="checkbox"
										accessibilityState={{ checked: on, disabled: busy }}
										accessibilityLabel={label}
										disabled={busy}
										onPress={() => toggle(row.id)}
										android_ripple={{ color: palette.outlineVariant }}
										style={({ pressed }) => ({
											flexDirection: "row",
											alignItems: "center",
											paddingVertical: SPACE.s,
											borderTopWidth: 1,
											borderTopColor: palette.outlineVariant,
											opacity: on
												? Platform.OS === "ios" && pressed
													? 0.6
													: 1
												: 0.45,
										})}
									>
										<View style={{ width: 44, alignItems: "center" }}>
											<View
												style={{
													width: 22,
													height: 22,
													borderRadius: Platform.OS === "ios" ? 11 : 4,
													borderWidth: 2,
													borderColor: on ? palette.primary : palette.outline,
													backgroundColor: on ? palette.primary : "transparent",
													alignItems: "center",
													justifyContent: "center",
												}}
											>
												{on ? (
													<Icon
														name="check"
														size={16}
														color={palette.onPrimary}
													/>
												) : null}
											</View>
										</View>
										{cells}
									</Pressable>
								) : (
									<View
										key={row.id}
										style={{
											flexDirection: "row",
											paddingVertical: SPACE.s,
											borderTopWidth: 1,
											borderTopColor: palette.outlineVariant,
										}}
									>
										{cells}
									</View>
								);
							})}
						</View>
					</ScrollView>
					{pending.preview.note ? (
						<View style={{ padding: SPACE.s }}>
							<Text variant="bodySmall" color={palette.onSurfaceVariant}>
								{pending.preview.note}
							</Text>
						</View>
					) : null}
				</View>
			) : null}

			{selectable ? (
				<Text variant="bodySmall" color={palette.onSecondaryContainer}>
					{`${selected.length} of ${rows.length}${hasHiddenRows ? " shown" : ""} selected`}
				</Text>
			) : null}

			<Pressable
				accessibilityRole="button"
				accessibilityState={{ expanded: showArgs }}
				onPress={() => setShowArgs((shown) => !shown)}
				hitSlop={8}
			>
				<Text variant="labelLarge" color={palette.onSecondaryContainer}>
					{showArgs ? "Hide the details" : "Show the details"}
				</Text>
			</Pressable>
			{showArgs ? (
				<ScrollView
					horizontal
					style={{
						maxHeight: 200,
						borderRadius: 8,
						backgroundColor: palette.surface,
					}}
					contentContainerStyle={{ padding: SPACE.s }}
				>
					<Text variant="bodySmall" color={palette.onSurfaceVariant}>
						{formatArgs(pending.arguments)}
					</Text>
				</ScrollView>
			) : null}

			<View
				style={{
					flexDirection: "row",
					justifyContent: "flex-end",
					gap: SPACE.s,
					paddingTop: SPACE.xs,
				}}
			>
				<ActionButton
					label="Decline"
					variant="text"
					disabled={busy}
					onPress={() => onDecide("rejected")}
				/>
				<ActionButton
					label={approveLabel}
					disabled={busy || (selectable && selected.length === 0)}
					onPress={() =>
						onDecide("approved", selectable ? selected : undefined)
					}
				/>
			</View>
		</Card>
	);
}
