import { View } from "react-native";

import {
	type SchemePref,
	setDisplayPref,
	useDisplayPrefs,
} from "../../ui/display-prefs";
import { useMotionPreference } from "../../ui/motion";
import { SegmentedControl } from "../../ui/segmented";
import { SettingsSection, SettingsSwitch } from "../../ui/settings-list";
import { isMaterialYouAvailable, useTheme } from "../../ui/theme";
import { ThemeSwatches } from "../../ui/theme-swatches";
import { SPACE } from "../../ui/type";

const SCHEMES: { value: SchemePref; label: string }[] = [
	{ value: "system", label: "System" },
	{ value: "light", label: "Light" },
	{ value: "dark", label: "Dark" },
];

/**
 * How the app looks on this phone: the sections of Preferences, Display,
 * as on the web. The choices stay on the phone (`src/ui/display-prefs.ts`)
 * and apply at once. They need no server.
 */
export function DisplaySections() {
	const prefs = useDisplayPrefs();
	const theme = useTheme();
	const { systemReduceMotion } = useMotionPreference();
	const wallpaper = isMaterialYouAvailable && prefs.materialYou;

	return (
		<>
			<SettingsSection
				title="Appearance"
				footer="System follows the light or dark mode of the phone."
			>
				<View style={{ padding: SPACE.l }}>
					<SegmentedControl
						options={SCHEMES}
						value={prefs.scheme}
						onChange={(scheme) => setDisplayPref("scheme", scheme)}
					/>
				</View>
			</SettingsSection>
			<SettingsSection
				title="Color"
				footer={
					wallpaper
						? "Material You takes the colors from your wallpaper. Turn it off to choose a theme color."
						: "The same theme colors as Farmer on the web."
				}
			>
				{isMaterialYouAvailable ? (
					<SettingsSwitch
						icon="wallpaper"
						tint="purple"
						title="Material You"
						subtitle="Use the colors of your wallpaper"
						value={prefs.materialYou}
						onValueChange={(on) => setDisplayPref("materialYou", on)}
					/>
				) : null}
				<View style={{ padding: SPACE.l }}>
					<ThemeSwatches
						value={prefs.theme}
						scheme={theme.scheme}
						disabled={wallpaper}
						onChange={(id) => setDisplayPref("theme", id)}
					/>
				</View>
			</SettingsSection>
			<SettingsSection title="Accessibility">
				<SettingsSwitch
					icon="contrast"
					tint="gray"
					title="High contrast"
					subtitle="Draw text and lines darker on the same background"
					value={prefs.highContrast}
					onValueChange={(on) => setDisplayPref("highContrast", on)}
				/>
				<SettingsSwitch
					icon="motion"
					tint="blue"
					title="Less motion"
					subtitle={
						systemReduceMotion
							? "On in the settings of the phone. Screens fade in and nothing slides."
							: "Screens fade in and nothing slides"
					}
					value={prefs.lessMotion || systemReduceMotion}
					disabled={systemReduceMotion}
					onValueChange={(on) => setDisplayPref("lessMotion", on)}
				/>
			</SettingsSection>
		</>
	);
}
