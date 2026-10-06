import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { Fragment, useMemo } from "react";
import {
	Platform,
	Pressable,
	Text as RNText,
	ScrollView,
	type TextStyle,
	View,
} from "react-native";

import { timeDayRoute } from "../time/day-link";
import { Skeleton, Text } from "../ui/components";
import type { Palette } from "../ui/palette";
import { usePalette } from "../ui/theme";
import { SPACE, TYPE } from "../ui/type";
import {
	type Align,
	type ChartSpec,
	columnAlign,
	parseBlocks,
	parseInline,
	printValue,
} from "./markdown";

const MONO = Platform.select({ ios: "Menlo", default: "monospace" });

/** The reading size of an answer. */
const BODY: TextStyle = TYPE.bodyLarge;

/** The inline parts of one line, as nested text. */
function Inline({ text, style }: { text: string; style?: TextStyle }) {
	const palette = usePalette();
	const router = useRouter();
	const parts = useMemo(() => parseInline(text), [text]);
	return (
		<RNText selectable style={[BODY, { color: palette.onSurface }, style]}>
			{parts.map((part, index) => {
				// The parts come again from one string on each streamed delta, so
				// the position is the identity.
				const key = `${index}-${part.kind}`;
				switch (part.kind) {
					case "code":
						return (
							<RNText
								key={key}
								style={{
									fontFamily: MONO,
									fontSize: 14,
									backgroundColor: palette.surfaceContainerHigh,
								}}
							>
								{part.text}
							</RNText>
						);
					case "bold":
						return (
							<RNText key={key} style={{ fontWeight: "600" }}>
								{part.text}
							</RNText>
						);
					case "italic":
						return (
							<RNText key={key} style={{ fontStyle: "italic" }}>
								{part.text}
							</RNText>
						);
					case "day":
						return (
							<RNText
								key={key}
								accessibilityRole="link"
								accessibilityHint="Opens the day in the timesheet"
								style={{
									color: palette.primary,
									textDecorationLine: "underline",
								}}
								onPress={() => router.navigate(timeDayRoute(part.day))}
							>
								{part.label}
							</RNText>
						);
					case "link":
						return part.href ? (
							<RNText
								key={key}
								accessibilityRole="link"
								style={{
									color: palette.primary,
									textDecorationLine: "underline",
								}}
								onPress={() => {
									if (part.href) {
										void WebBrowser.openBrowserAsync(part.href).catch(
											() => undefined,
										);
									}
								}}
							>
								{part.text}
							</RNText>
						) : (
							<Fragment key={key}>{part.text}</Fragment>
						);
					case "text":
						return <Fragment key={key}>{part.text}</Fragment>;
				}
			})}
		</RNText>
	);
}

/** The width of a column, from its longest cell. A long column wraps. */
const columnWidth = (head: string, cells: string[]) => {
	const longest = cells.reduce(
		(widest, cell) => Math.max(widest, cell.length),
		head.length,
	);
	return Math.min(Math.max(longest * 8 + SPACE.l * 2, 64), 240);
};

const textAlign = (align: Align): TextStyle["textAlign"] => align;

function AnswerTable({
	head,
	rows,
	align,
}: {
	head: string[];
	rows: string[][];
	align: (Align | null)[];
}) {
	const palette = usePalette();
	const aligns = columnAlign(head, rows, align);
	const widths = aligns.map((_, column) =>
		columnWidth(
			head[column] ?? "",
			rows.map((row) => row[column] ?? ""),
		),
	);
	const cell = (content: string, column: number, header: boolean) => (
		<View
			// The columns have a fixed order: the position is the column.
			key={column}
			style={{
				// The column is at least its own width. When the table is narrower
				// than the frame, each column takes a share of the rest in
				// proportion to its width, so the rows and the lines fill the
				// frame. A wider table keeps its widths and scrolls.
				flexBasis: widths[column],
				flexGrow: widths[column],
				flexShrink: 0,
				paddingHorizontal: SPACE.m,
				paddingVertical: SPACE.s,
			}}
		>
			{content.trim() === "" && !header ? (
				<Text variant="bodyMedium" color={palette.outline}>
					-
				</Text>
			) : (
				<Inline
					text={content}
					style={{
						...(header ? TYPE.labelMedium : TYPE.bodyMedium),
						color: header ? palette.onSurfaceVariant : palette.onSurface,
						textAlign: textAlign(aligns[column] ?? "left"),
						fontVariant: ["tabular-nums"],
					}}
				/>
			)}
		</View>
	);
	return (
		<ScrollView
			horizontal
			showsHorizontalScrollIndicator={false}
			style={{
				borderRadius: 12,
				borderWidth: 1,
				borderColor: palette.outlineVariant,
				backgroundColor: palette.surface,
			}}
			contentContainerStyle={{ flexGrow: 1 }}
		>
			<View style={{ flexGrow: 1 }}>
				<View
					style={{
						flexDirection: "row",
						backgroundColor: palette.surfaceContainer,
						borderBottomWidth: 1,
						borderBottomColor: palette.outlineVariant,
					}}
				>
					{aligns.map((_, column) => cell(head[column] ?? "", column, true))}
				</View>
				{rows.map((row, rowIndex) => (
					<View
						// oxlint-disable-next-line react/no-array-index-key -- a row grows while it streams, so the position is the identity
						key={rowIndex}
						style={{
							flexDirection: "row",
							borderBottomWidth: rowIndex === rows.length - 1 ? 0 : 1,
							borderBottomColor: palette.outlineVariant,
						}}
					>
						{aligns.map((_, column) => cell(row[column] ?? "", column, false))}
					</View>
				))}
			</View>
		</ScrollView>
	);
}

function Chart({ spec, palette }: { spec: ChartSpec; palette: Palette }) {
	// The baseline is zero and each bar is measured against the largest
	// value, so a short bar is never made to look long. A negative value
	// stays at the baseline.
	const peak = Math.max(...spec.data.map((point) => Math.abs(point.value)), 0);
	const share = (value: number) =>
		peak === 0 ? 0 : Math.max(0, (value / peak) * 100);
	const summary = spec.data
		.map((point) => `${point.label} ${printValue(point.value, spec.unit)}`)
		.join(", ");

	return (
		<View
			accessible
			accessibilityLabel={`${spec.title ?? "Chart"}: ${summary}`}
			style={{ gap: SPACE.s }}
		>
			{spec.title ? (
				<Text variant="labelLarge" color={palette.onSurfaceVariant}>
					{spec.title}
				</Text>
			) : null}
			{spec.type === "trend" ? (
				<ScrollView horizontal showsHorizontalScrollIndicator={false}>
					<View style={{ flexDirection: "row", gap: SPACE.xs }}>
						{spec.data.map((point, index) => (
							<View
								// oxlint-disable-next-line react/no-array-index-key -- the points come again on each delta, so the position is the identity
								key={index}
								style={{ width: 36, alignItems: "center", gap: SPACE.xs }}
							>
								<Text variant="bodySmall" color={palette.onSurfaceVariant}>
									{printValue(point.value, spec.unit)}
								</Text>
								<View
									style={{
										height: 72,
										width: "100%",
										justifyContent: "flex-end",
										borderRadius: 4,
										backgroundColor: palette.surfaceContainerHigh,
									}}
								>
									<View
										style={{
											height: `${Math.max(share(point.value), 2)}%`,
											borderRadius: 4,
											backgroundColor: palette.primary,
										}}
									/>
								</View>
								<Text
									variant="bodySmall"
									color={palette.onSurfaceVariant}
									numberOfLines={1}
								>
									{point.label}
								</Text>
							</View>
						))}
					</View>
				</ScrollView>
			) : (
				<View style={{ gap: SPACE.s }}>
					{spec.data.map((point, index) => (
						<View
							// oxlint-disable-next-line react/no-array-index-key -- the points come again on each delta, so the position is the identity
							key={index}
							style={{ gap: 2 }}
						>
							<View
								style={{
									flexDirection: "row",
									justifyContent: "space-between",
									gap: SPACE.s,
								}}
							>
								<View style={{ flex: 1 }}>
									<Text variant="bodyMedium" numberOfLines={1}>
										{point.label}
									</Text>
								</View>
								<Text variant="bodyMedium" color={palette.onSurfaceVariant}>
									{printValue(point.value, spec.unit)}
								</Text>
							</View>
							<View
								style={{
									height: 8,
									borderRadius: 4,
									backgroundColor: palette.surfaceContainerHigh,
								}}
							>
								<View
									style={{
										height: 8,
										width: `${share(point.value)}%`,
										borderRadius: 4,
										backgroundColor: palette.primary,
									}}
								/>
							</View>
						</View>
					))}
				</View>
			)}
		</View>
	);
}

function Chips({
	prompts,
	ready,
	onFollowUp,
}: {
	prompts: string[];
	ready: boolean;
	onFollowUp?: (prompt: string) => void;
}) {
	const palette = usePalette();
	if (!ready) {
		return (
			<View style={{ flexDirection: "row", gap: SPACE.s }}>
				<Skeleton height={36} width={140} radius={18} />
				<Skeleton height={36} width={110} radius={18} />
			</View>
		);
	}
	if (prompts.length === 0) return null;
	return (
		<View style={{ flexDirection: "row", flexWrap: "wrap", gap: SPACE.s }}>
			{prompts.map((prompt) => (
				<Pressable
					key={prompt}
					accessibilityRole="button"
					accessibilityState={{ disabled: !onFollowUp }}
					disabled={!onFollowUp}
					onPress={() => onFollowUp?.(prompt)}
					android_ripple={{ color: palette.outlineVariant }}
					style={({ pressed }) => ({
						borderRadius: 18,
						borderWidth: 1,
						borderColor: palette.outlineVariant,
						paddingHorizontal: SPACE.m,
						paddingVertical: SPACE.s,
						opacity: !onFollowUp
							? 0.5
							: Platform.OS === "ios" && pressed
								? 0.6
								: 1,
					})}
				>
					<Text variant="bodyMedium">{prompt}</Text>
				</Pressable>
			))}
		</View>
	);
}

/**
 * One answer, drawn from the markdown the model wrote. `streaming` is true
 * for the turn in flight; it draws an open chart as a placeholder.
 * `onFollowUp` sends a chip as the next message, and is absent while a turn
 * runs.
 */
export function Answer({
	text,
	streaming = false,
	onFollowUp,
}: {
	text: string;
	streaming?: boolean;
	onFollowUp?: (prompt: string) => void;
}) {
	const palette = usePalette();
	const blocks = useMemo(() => parseBlocks(text, streaming), [text, streaming]);
	if (!text.trim()) return null;
	return (
		<View style={{ gap: SPACE.m }}>
			{blocks.map((block, index) => {
				// A block is keyed by its kind and its place, so a block that grows
				// while it streams keeps its view.
				const key = `${block.kind}-${index}`;
				switch (block.kind) {
					case "p":
						return <Inline key={key} text={block.text} />;
					case "h":
						return (
							<Inline
								key={key}
								text={block.text}
								style={{ ...TYPE.titleMedium, marginTop: SPACE.xs }}
							/>
						);
					case "ul":
					case "ol":
						return (
							<View key={key} style={{ gap: SPACE.xs }}>
								{block.items.map((item, itemIndex) => (
									<View
										// oxlint-disable-next-line react/no-array-index-key -- the list comes again on each delta, so the position is the identity
										key={itemIndex}
										style={{ flexDirection: "row", gap: SPACE.s }}
									>
										<View style={{ minWidth: 16 }}>
											{block.kind === "ol" ? (
												<Text color={palette.onSurfaceVariant}>
													{`${itemIndex + 1}.`}
												</Text>
											) : (
												<View
													style={{
														width: 5,
														height: 5,
														borderRadius: 3,
														marginTop: 10,
														marginLeft: 4,
														backgroundColor: palette.onSurfaceVariant,
													}}
												/>
											)}
										</View>
										<View style={{ flex: 1 }}>
											<Inline text={item} />
										</View>
									</View>
								))}
							</View>
						);
					case "table":
						return (
							<AnswerTable
								key={key}
								head={block.head}
								rows={block.rows}
								align={block.align}
							/>
						);
					case "hr":
						return (
							<View
								key={key}
								style={{ height: 1, backgroundColor: palette.outlineVariant }}
							/>
						);
					case "chart":
						return block.spec ? (
							<Chart key={key} spec={block.spec} palette={palette} />
						) : (
							<Skeleton key={key} height={120} />
						);
					case "next":
						return (
							<Chips
								key={key}
								prompts={block.prompts}
								ready={block.ready}
								onFollowUp={onFollowUp}
							/>
						);
					case "code":
						return (
							<ScrollView
								key={key}
								horizontal
								style={{
									borderRadius: 10,
									backgroundColor: palette.surfaceContainerHigh,
								}}
								contentContainerStyle={{ padding: SPACE.m }}
							>
								<RNText
									selectable
									style={{
										fontFamily: MONO,
										fontSize: 13,
										lineHeight: 19,
										color: palette.onSurface,
									}}
								>
									{block.text}
								</RNText>
							</ScrollView>
						);
				}
			})}
		</View>
	);
}
