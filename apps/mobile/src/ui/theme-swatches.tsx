import { Pressable, View } from "react-native";

import { Text } from "./components";
import {
	farmerTokens,
	type Scheme,
	seedTokens,
	type ThemeId,
	THEMES,
} from "./farmer-theme";
import { Icon } from "./icon";
import { usePalette } from "./theme";
import { SPACE } from "./type";

const SIZE = 48;

/**
 * The theme colours as round swatches, each with its name. A swatch shows
 * the theme's own paper with its accent on it, so "Farmer" (warm paper) and
 * "Violet" (violet-tinted paper) differ, as on the web. Neither platform has
 * a native control for a fixed set of colours, so this is drawn here.
 */
export function ThemeSwatches({
	value,
	scheme,
	onChange,
	disabled,
}: {
	value: ThemeId;
	scheme: Scheme;
	onChange: (id: ThemeId) => void;
	disabled?: boolean;
}) {
	const palette = usePalette();
	return (
		<View
			accessibilityRole="radiogroup"
			accessibilityLabel="Theme color"
			style={{
				flexDirection: "row",
				flexWrap: "wrap",
				gap: SPACE.m,
				opacity: disabled ? 0.38 : 1,
			}}
		>
			{THEMES.map((theme) => {
				const tokens = theme.seed
					? seedTokens(theme.seed, scheme, "normal")
					: farmerTokens(scheme, "normal");
				const selected = theme.id === value;
				return (
					<Pressable
						key={theme.id}
						accessibilityRole="radio"
						accessibilityLabel={theme.label}
						accessibilityState={{ checked: selected, disabled }}
						disabled={disabled}
						onPress={() => onChange(theme.id)}
						style={{ width: 64, alignItems: "center", gap: SPACE.xs }}
					>
						<View
							style={{
								width: SIZE,
								height: SIZE,
								borderRadius: SIZE / 2,
								alignItems: "center",
								justifyContent: "center",
								backgroundColor: tokens.bg,
								borderWidth: selected ? 3 : 1,
								borderColor: selected ? palette.primary : palette.outline,
							}}
						>
							<View
								style={{
									width: 26,
									height: 26,
									borderRadius: 13,
									alignItems: "center",
									justifyContent: "center",
									backgroundColor: tokens.acc,
								}}
							>
								{selected ? (
									<Icon name="check" size={18} color={tokens.bg} />
								) : null}
							</View>
						</View>
						<Text
							variant="labelMedium"
							color={selected ? palette.onSurface : palette.onSurfaceVariant}
							numberOfLines={1}
						>
							{theme.label}
						</Text>
					</Pressable>
				);
			})}
		</View>
	);
}
