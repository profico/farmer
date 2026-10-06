import { mixHex, withAlpha } from "./color";
import {
	type Contrast,
	paletteOf,
	type Scheme,
	type Tokens,
} from "./farmer-theme";
import type { Palette } from "./palette";

// The colour roles of iOS. The backgrounds, the text, the separators and the
// fills are the system colours of UIKit. The accent (the chosen theme colour)
// is the only colour that the theme still decides, and it is the tint of the
// app: buttons, links, switches, selections and progress.
//
// Why hex and not `PlatformColor`: a `PlatformColor` is a dynamic colour that
// UIKit resolves when a native view takes it. The header of a screen takes it
// once, and then keeps the old mode when the app changes its own Light or
// Dark setting (`Appearance.setColorScheme`). Also, the code does colour
// arithmetic on the roles (`withAlpha`, `mixHex`, the contrast tests), and
// that needs a hex string. So each role holds the value of the system colour
// in the mode in force, picked by the app's own scheme and contrast. The
// values come from the iOS 26 colour tables of the Human Interface
// Guidelines. A system colour with an alpha (label levels, separator) is
// given as the opaque colour that it makes on its own background, so it can
// be mixed. A fill keeps its alpha, because it sits on many surfaces.
//
// High contrast is the "Increase Contrast" variant of each system colour.
// Where Apple does not publish the value, the value here is the nearest
// accessible one, and the tests hold it at 7:1 for the text.

type System = {
	/** `systemGroupedBackground`. */
	grouped: string;
	/** `secondarySystemGroupedBackground`: a row or a card on `grouped`. */
	groupedRaised: string;
	label: string;
	secondaryLabel: string;
	/** `opaqueSeparator`. */
	separator: string;
	/** `systemFill` and `secondarySystemFill`, with their alpha. */
	fill: string;
	secondaryFill: string;
	red: string;
	green: string;
	orange: string;
	/** The label on a button in the accent colour. */
	onTint: string;
	inverse: string;
	onInverse: string;
};

const SYSTEM = {
	normal: {
		light: {
			grouped: "#f2f2f7",
			groupedRaised: "#ffffff",
			label: "#000000",
			secondaryLabel: "#8a8a8e",
			separator: "#c6c6c8",
			fill: "#78788033",
			secondaryFill: "#78788029",
			red: "#ff3b30",
			green: "#34c759",
			orange: "#ff9500",
			onTint: "#ffffff",
			inverse: "#2c2c2e",
			onInverse: "#ffffff",
		},
		dark: {
			grouped: "#000000",
			groupedRaised: "#1c1c1e",
			label: "#ffffff",
			secondaryLabel: "#8d8d93",
			separator: "#38383a",
			fill: "#7878805c",
			secondaryFill: "#78788052",
			red: "#ff453a",
			green: "#30d158",
			orange: "#ff9f0a",
			onTint: "#000000",
			inverse: "#e5e5ea",
			onInverse: "#000000",
		},
	},
	high: {
		light: {
			grouped: "#f2f2f7",
			groupedRaised: "#ffffff",
			label: "#000000",
			secondaryLabel: "#48484a",
			separator: "#8e8e93",
			fill: "#78788040",
			secondaryFill: "#78788036",
			red: "#d70015",
			green: "#248a3d",
			orange: "#c93400",
			onTint: "#ffffff",
			inverse: "#2c2c2e",
			onInverse: "#ffffff",
		},
		dark: {
			grouped: "#000000",
			groupedRaised: "#1c1c1e",
			label: "#ffffff",
			secondaryLabel: "#d1d1d6",
			separator: "#636366",
			fill: "#78788070",
			secondaryFill: "#78788066",
			red: "#ff6961",
			green: "#30db5b",
			orange: "#ffb340",
			onTint: "#000000",
			inverse: "#e5e5ea",
			onInverse: "#000000",
		},
	},
} as const satisfies {
	[contrast in Contrast]: { [scheme in Scheme]: System };
};

/**
 * The palette of iOS for one theme colour. The accent roles come from the
 * theme tokens (`paletteOf`). Every other role is overwritten with a system
 * colour.
 */
export const iosPaletteOf = (
	tokens: Tokens,
	scheme: Scheme,
	contrast: Contrast,
): Palette => {
	const dark = scheme === "dark";
	const system: System = SYSTEM[contrast][scheme];
	const base = paletteOf(tokens, scheme, contrast);
	const raised = system.groupedRaised;
	return {
		...base,
		background: system.grouped,
		surface: raised,
		surfaceDim: system.grouped,
		surfaceBright: raised,
		surfaceContainerLowest: raised,
		surfaceContainerLow: raised,
		surfaceContainer: raised,
		// Pressed rows, chips and the fills in a card: `secondarySystemFill`.
		surfaceContainerHigh: system.secondaryFill,
		surfaceContainerHighest: system.fill,
		onSurface: system.label,
		onSurfaceVariant: system.secondaryLabel,
		onPrimary: system.onTint,
		// The accent mixed into the raised surface, as a selected chip.
		primaryContainer: mixHex(tokens.acc, raised, dark ? 0.26 : 0.16),
		onPrimaryContainer: system.label,
		secondary: mixHex(tokens.acc, system.secondaryLabel, 0.45),
		onSecondary: system.onTint,
		secondaryContainer: mixHex(tokens.acc, raised, dark ? 0.2 : 0.12),
		onSecondaryContainer: system.label,
		tertiary: system.orange,
		onTertiary: system.onTint,
		tertiaryContainer: mixHex(system.orange, raised, dark ? 0.24 : 0.16),
		onTertiaryContainer: mixHex(system.orange, system.label, 0.45),
		inverseSurface: system.inverse,
		inverseOnSurface: system.onInverse,
		outline: system.separator,
		outlineVariant: system.separator,
		disabledContainer: withAlpha(system.label, 0.12),
		onDisabled: withAlpha(system.label, 0.3),
		error: system.red,
		onError: system.onTint,
		errorContainer: mixHex(system.red, raised, dark ? 0.22 : 0.12),
		onErrorContainer: mixHex(system.red, system.label, 0.45),
		success: system.green,
		successContainer: mixHex(system.green, raised, dark ? 0.24 : 0.16),
		onSuccessContainer: mixHex(system.green, system.label, 0.45),
		warning: system.orange,
		warningContainer: mixHex(system.orange, raised, dark ? 0.24 : 0.16),
		onWarningContainer: mixHex(system.orange, system.label, 0.45),
	};
};

/** The system roles that the palette does not name, for a test. */
export const iosSystemColors = (
	scheme: Scheme,
	contrast: Contrast,
): Readonly<System> => SYSTEM[contrast][scheme];
