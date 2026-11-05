import type { TextStyle } from "react-native";

/** The Material 3 type scale, in the system font. */
export const TYPE = {
	headlineMedium: { fontSize: 28, lineHeight: 36 },
	headlineSmall: { fontSize: 24, lineHeight: 32 },
	titleLarge: { fontSize: 22, lineHeight: 28 },
	titleMedium: { fontSize: 16, lineHeight: 24, fontWeight: "500" },
	titleSmall: { fontSize: 14, lineHeight: 20, fontWeight: "500" },
	bodyLarge: { fontSize: 16, lineHeight: 24 },
	bodyMedium: { fontSize: 14, lineHeight: 20 },
	bodySmall: { fontSize: 12, lineHeight: 16 },
	labelLarge: { fontSize: 14, lineHeight: 20, fontWeight: "500" },
	labelMedium: { fontSize: 12, lineHeight: 16, fontWeight: "500" },
	displaySmall: {
		fontSize: 36,
		lineHeight: 44,
		fontVariant: ["tabular-nums"],
	},
	// The Material 3 Expressive emphasized variants. The size and the line
	// height do not change, only the weight.
	headlineMediumEmphasized: { fontSize: 28, lineHeight: 36, fontWeight: "500" },
	titleSmallEmphasized: { fontSize: 14, lineHeight: 20, fontWeight: "700" },
} as const satisfies { [variant: string]: TextStyle };

export type TypeVariant = keyof typeof TYPE;

/** The 4dp grid. */
export const SPACE = { xs: 4, s: 8, m: 12, l: 16, xl: 24, xxl: 32 } as const;
