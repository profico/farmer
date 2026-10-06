import { Image, Platform, Text as RNText, View } from "react-native";

import { useSignedIn } from "../../session/session";
import { usePalette } from "../../ui/theme";
import { isSvgUpload } from "../../uploads/limits";
import { isUploadedIcon, markOf } from "../model";

const SIZES = { small: 36, large: 56 } as const;

/**
 * A project's mark: its uploaded image, its emoji, or the first letter of
 * its name, on a quiet square. An uploaded SVG shows the letter, because
 * React Native cannot draw an SVG file. It is hidden from a screen reader:
 * the row beside it says the name.
 */
export function ProjectMark({
	icon,
	name,
	size = "small",
}: {
	icon: string | null;
	name: string;
	size?: keyof typeof SIZES;
}) {
	const palette = usePalette();
	const { origin } = useSignedIn();
	const side = SIZES[size];
	const text = markOf(icon, name);
	const letter = text !== icon;
	const image = icon && isUploadedIcon(icon) && !isSvgUpload(icon);
	return (
		<View
			accessible={false}
			importantForAccessibility="no-hide-descendants"
			accessibilityElementsHidden
			style={{
				width: side,
				height: side,
				borderRadius: Platform.OS === "ios" ? side * 0.25 : side * 0.3,
				borderCurve: "continuous",
				alignItems: "center",
				justifyContent: "center",
				backgroundColor: palette.surfaceContainerHigh,
				overflow: "hidden",
			}}
		>
			{image ? (
				// The files of `/api/files/` need no sign-in (see the web's
				// `routes/api/files/$.ts`).
				<Image
					source={{ uri: `${origin}${icon}` }}
					style={{ width: side, height: side }}
					resizeMode="contain"
				/>
			) : (
				<RNText
					style={{
						fontSize: letter ? side * 0.42 : side * 0.55,
						fontWeight: letter ? "500" : undefined,
						color: palette.onSurfaceVariant,
					}}
				>
					{text}
				</RNText>
			)}
		</View>
	);
}
