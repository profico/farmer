import { useId } from "react";
import type { ColorValue } from "react-native";
import Svg, { Defs, LinearGradient, Path, Stop } from "react-native-svg";

import { MARK_GRADIENT, MARK_PATH, WORDMARK_PATHS } from "./brand-paths";
import { usePalette } from "./theme";

// The Farmer mark and the wordmark, as the web draws them
// (`apps/web/src/components/farmer-mark.tsx` and `farmer-logo.tsx`). The
// tile keeps its own violet in every theme: it is the one fixed colour of the
// brand, and a violet tile is legible on a light and on a dark ground. The
// letters follow the text colour of the theme.

/** An SVG id from `useId`, which holds colons. */
const svgId = (id: string) => `farmer-${id.replace(/[^a-zA-Z0-9]/g, "")}`;

function MarkPaths({ gradientId }: { gradientId: string }) {
	return (
		<>
			<Defs>
				<LinearGradient
					id={gradientId}
					x1={MARK_GRADIENT.x1}
					y1={MARK_GRADIENT.y1}
					x2={MARK_GRADIENT.x2}
					y2={MARK_GRADIENT.y2}
					gradientUnits="userSpaceOnUse"
				>
					<Stop offset={0} stopColor={MARK_GRADIENT.from} />
					<Stop offset={1} stopColor={MARK_GRADIENT.to} />
				</LinearGradient>
			</Defs>
			<Path d={MARK_PATH} fill={MARK_GRADIENT.from} />
			<Path d={MARK_PATH} fill={`url(#${gradientId})`} />
		</>
	);
}

/** The violet tile alone. A screen reader skips it: the screen around it
 *  names the app. */
export function FarmerMark({ size }: { size: number }) {
	const gradientId = svgId(useId());
	return (
		<Svg
			width={size}
			height={size}
			viewBox="0 0 82 82"
			accessible={false}
			importantForAccessibility="no-hide-descendants"
		>
			<MarkPaths gradientId={gradientId} />
		</Svg>
	);
}

/** The mark and the word "Farmer". The letters take `color`, or the text
 *  colour of the theme. */
export function FarmerLogo({
	height,
	color,
}: {
	height: number;
	color?: ColorValue;
}) {
	const palette = usePalette();
	const gradientId = svgId(useId());
	return (
		<Svg
			width={(height * 367) / 82}
			height={height}
			viewBox="0 0 367 82"
			accessible
			accessibilityRole="image"
			accessibilityLabel="Farmer"
		>
			{WORDMARK_PATHS.map((d) => (
				<Path key={d.slice(0, 24)} d={d} fill={color ?? palette.onSurface} />
			))}
			<MarkPaths gradientId={gradientId} />
		</Svg>
	);
}
