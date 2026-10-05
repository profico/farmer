import { Redirect, Stack } from "expo-router";

import { useSignedIn } from "../../src/session/session";
import { usePalette } from "../../src/ui/theme";

/**
 * The forms of the Time tab that are larger than one entry: time off over
 * a range, the unfiled time and the notes of a week row. The root layout
 * opens this stack as a sheet, and each form draws its own header
 * (`forms/sheet.tsx`). A link that comes before a workspace is chosen goes
 * to the tabs, as in `SectionStack`.
 */
export default function TimeFormsLayout() {
	const { workspace } = useSignedIn();
	const palette = usePalette();
	if (!workspace) return <Redirect href="/" />;
	return (
		<Stack
			screenOptions={{
				headerShown: false,
				contentStyle: { backgroundColor: palette.surface },
			}}
		/>
	);
}
