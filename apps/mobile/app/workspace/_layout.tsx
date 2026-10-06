import { Redirect, Stack } from "expo-router";
import { Platform } from "react-native";

import { useStackOptions } from "../../src/navigation/section-stack";
import { useSignedIn } from "../../src/session/session";
import { usePalette } from "../../src/ui/theme";

/** The forms of the workspace screens. Each opens over its list. */
const FORMS = [
	"people/invite",
	"clients/edit",
	"tasks/edit",
	"hour-fund/month",
	"integrations/slack-test",
	"webhooks/new",
	"webhooks/[id]/edit",
	"audit-log/export",
] as const;

/**
 * The stack of the workspace screens. It is `SectionStack` with one change:
 * the forms open as sheets on iOS and as full-screen dialogs on Android, as
 * the forms of the root stack do. A screen cannot set its own presentation
 * reliably, so the layout declares it.
 */
export default function WorkspaceLayout() {
	const { workspace } = useSignedIn();
	const options = useStackOptions();
	const palette = usePalette();
	if (!workspace) return <Redirect href="/" />;
	const form = {
		presentation:
			Platform.OS === "ios" ? ("formSheet" as const) : ("modal" as const),
		sheetGrabberVisible: true,
		sheetAllowedDetents: [1],
		headerShown: Platform.OS === "ios",
		contentStyle: { backgroundColor: palette.surface },
	};
	return (
		<Stack screenOptions={options}>
			{FORMS.map((name) => (
				<Stack.Screen key={name} name={name} options={form} />
			))}
		</Stack>
	);
}
