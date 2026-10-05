import { Stack } from "expo-router";
import { View } from "react-native";

import {
	type SchemePref,
	setDisplayPref,
	useDisplayPrefs,
} from "../../src/ui/display-prefs";
import { useMotionPreference } from "../../src/ui/motion";
import { Screen } from "../../src/ui/screen";
import { SegmentedControl } from "../../src/ui/segmented";
import { SettingsSection, SettingsSwitch } from "../../src/ui/settings-list";
import { isMaterialYouAvailable, useTheme } from "../../src/ui/theme";
import { ThemeSwatches } from "../../src/ui/theme-swatches";
import { SPACE } from "../../src/ui/type";

const SCHEMES: { value: SchemePref; label: string }[] = [
	{ value: "system", label: "System" },
	{ value: "light", label: "Light" },
	{ value: "dark", label: "Dark" },
];

/**
 * How the app looks on this phone, as Preferences, Display does on the web.
 * The choices stay on the phone (`src/ui/display-prefs.ts`) and apply at
 * once.
 */
export default function DisplayScreen() {
	const prefs = useDisplayPrefs();
	const theme = useTheme();
	const { systemReduceMotion } = useMotionPreference();
	const wallpaper = isMaterialYouAvailable && prefs.materialYou;

	return (
		<>
			<Stack.Screen options={{ title: "Display" }} />
			<Screen topInset={false}>
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
			</Screen>
		</>
	);
}
