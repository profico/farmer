import { Redirect, Stack, useSegments } from "expo-router";
import { Platform, View } from "react-native";

import { useAccess } from "../../src/api/capabilities";
import { adminGate } from "../../src/navigation/admin-routes";
import {
	useFormOptions,
	useStackOptions,
} from "../../src/navigation/section-stack";
import { useSignedIn } from "../../src/session/session";
import { ErrorState } from "../../src/ui/components";
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
 * reliably, so the layout declares it. It also keeps a person who is not an
 * admin out of the admin screens: a link can open one of them directly.
 */
export default function WorkspaceLayout() {
	const { workspace } = useSignedIn();
	if (!workspace) return <Redirect href="/" />;
	return <GatedStack />;
}

/** The inner part reads the capabilities, which need a workspace. */
function GatedStack() {
	const options = useStackOptions();
	const form = useFormOptions({ headerShown: Platform.OS === "ios" });
	const palette = usePalette();
	const access = useAccess();
	const segments = useSegments();
	const gate = adminGate(segments, access);
	if (gate === "redirect") return <Redirect href="/" />;
	if (gate === "wait") {
		if (!access.error) return null;
		return (
			<View
				style={{
					flex: 1,
					justifyContent: "center",
					backgroundColor: palette.background,
				}}
			>
				<ErrorState error={access.error} onRetry={access.retry} />
			</View>
		);
	}
	return (
		<Stack screenOptions={options}>
			{FORMS.map((name) => (
				<Stack.Screen key={name} name={name} options={form} />
			))}
		</Stack>
	);
}
