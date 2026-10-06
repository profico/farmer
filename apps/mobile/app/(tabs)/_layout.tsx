import { NativeTabs } from "expo-router/unstable-native-tabs";
import { useEffect, type ReactNode } from "react";
import { Platform, View } from "react-native";

import { useMe } from "../../src/api/queries";
import { NoWorkspace } from "../../src/onboarding/no-workspace";
import { useSession } from "../../src/session/session";
import { ActionButton, ErrorState, Skeleton } from "../../src/ui/components";
import { usePalette } from "../../src/ui/theme";
import { SPACE } from "../../src/ui/type";

function Loading() {
	const palette = usePalette();
	return (
		<View
			style={{
				flex: 1,
				backgroundColor: palette.background,
				padding: SPACE.l,
				paddingTop: 96,
				gap: SPACE.l,
			}}
		>
			<Skeleton height={36} width="60%" />
			<Skeleton height={160} />
			<Skeleton height={72} />
			<Skeleton height={72} />
		</View>
	);
}

function Centered({ children }: { children: ReactNode }) {
	const palette = usePalette();
	return (
		<View
			style={{
				flex: 1,
				justifyContent: "center",
				backgroundColor: palette.background,
			}}
		>
			{children}
		</View>
	);
}

/**
 * The four tabs, once a workspace is chosen. The workspace is the stored
 * one while the person is still a member of it, else the first one `/me`
 * lists.
 */
function SignedInTabs() {
	const palette = usePalette();
	const { state, setWorkspace, forget } = useSession();
	const me = useMe();
	const stored = state.status === "signed_in" ? state.session.workspace : null;
	const organizations = me.data?.organizations ?? [];
	const valid = organizations.some((org) => org.slug === stored);
	const fallback = organizations[0]?.slug;

	useEffect(() => {
		if (me.data && !valid && fallback) void setWorkspace(fallback);
	}, [me.data, valid, fallback, setWorkspace]);

	if (me.isPending) return <Loading />;
	if (me.isError) {
		return (
			<Centered>
				<ErrorState error={me.error} onRetry={() => void me.refetch()} />
				<View style={{ alignItems: "center" }}>
					<ActionButton
						label="Sign out"
						variant="text"
						onPress={() => void forget()}
					/>
				</View>
			</Centered>
		);
	}
	if (organizations.length === 0) {
		return <NoWorkspace email={me.data.user.email} />;
	}
	if (!valid) return <Loading />;

	// The scene behind each tab, in the theme: without it a tab switch can
	// show the white default for a frame.
	const scene = { backgroundColor: palette.background };

	return (
		<NativeTabs
			backgroundColor={
				Platform.OS === "android" ? palette.surfaceContainer : undefined
			}
			indicatorColor={
				Platform.OS === "android" ? palette.secondaryContainer : undefined
			}
			tintColor={palette.primary}
			// Every tab shows its label, always. Material hides the label of a
			// tab that is not selected when there are four tabs or more; iOS
			// shows every label by default.
			labelVisibilityMode="labeled"
		>
			<NativeTabs.Trigger name="index" contentStyle={scene}>
				<NativeTabs.Trigger.Label>Time</NativeTabs.Trigger.Label>
				<NativeTabs.Trigger.Icon sf="clock" md="schedule" />
			</NativeTabs.Trigger>
			<NativeTabs.Trigger name="projects" contentStyle={scene}>
				<NativeTabs.Trigger.Label>Projects</NativeTabs.Trigger.Label>
				<NativeTabs.Trigger.Icon sf="folder" md="folder" />
			</NativeTabs.Trigger>
			<NativeTabs.Trigger name="reports" contentStyle={scene}>
				<NativeTabs.Trigger.Label>Reports</NativeTabs.Trigger.Label>
				<NativeTabs.Trigger.Icon sf="chart.bar" md="bar_chart" />
			</NativeTabs.Trigger>
			<NativeTabs.Trigger name="more" contentStyle={scene}>
				<NativeTabs.Trigger.Label>More</NativeTabs.Trigger.Label>
				<NativeTabs.Trigger.Icon sf="ellipsis.circle" md="more_horiz" />
			</NativeTabs.Trigger>
		</NativeTabs>
	);
}

export default function TabsLayout() {
	const { state } = useSession();
	// The guard in the root layout leaves this screen as the session ends;
	// nothing here may read the session in that last frame.
	if (state.status !== "signed_in") return null;
	return <SignedInTabs />;
}
