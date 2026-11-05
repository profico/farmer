import { View } from "react-native";

import { Card, Skeleton, Text } from "../../ui/components";
import { usePalette } from "../../ui/theme";
import { SPACE } from "../../ui/type";

/** The total of a report: a label, the figure and a line under it. */
export function TotalFigure({
	label = "Total hours",
	value,
	caption,
}: {
	label?: string;
	/** Null while the figure loads. */
	value: string | null;
	caption?: string;
}) {
	const palette = usePalette();
	return (
		<View
			accessible
			accessibilityLabel={
				value === null
					? `${label}, loading`
					: [label, value, caption].filter(Boolean).join(", ")
			}
			style={{ gap: SPACE.xs }}
		>
			<Text variant="labelMedium" color={palette.onSurfaceVariant}>
				{label}
			</Text>
			{value === null ? (
				<Skeleton height={32} width={120} radius={8} />
			) : (
				<Text variant="headlineSmall">{value}</Text>
			)}
			{caption ? (
				<Text variant="bodySmall" color={palette.onSurfaceVariant}>
					{caption}
				</Text>
			) : null}
		</View>
	);
}

export type Tile = { label: string; value: string | null; caption?: string };

/** Figures in a grid of two columns, such as the overview of a project. */
export function StatTiles({ tiles }: { tiles: Tile[] }) {
	return (
		<View style={{ flexDirection: "row", flexWrap: "wrap", gap: SPACE.s }}>
			{tiles.map((tile) => (
				<View key={tile.label} style={{ flexBasis: "48%", flexGrow: 1 }}>
					{/* The row stretches the two tiles of a line to one height.
					    A height of 100% grew each tile to the whole screen. */}
					<Card style={{ flexGrow: 1 }}>
						<TotalFigure
							label={tile.label}
							value={tile.value}
							caption={tile.caption}
						/>
					</Card>
				</View>
			))}
		</View>
	);
}
