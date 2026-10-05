import type { ReactNode } from "react";
import { Alert, Linking, View } from "react-native";

import { useMe, useWorkspace } from "../../src/api/queries";
import { APP_VERSION } from "../../src/config";
import { useSession } from "../../src/session/session";
import {
	ErrorState,
	ListRow,
	SectionHeader,
	Skeleton,
} from "../../src/ui/components";
import { Icon } from "../../src/ui/icon";
import { Inset, Screen } from "../../src/ui/screen";
import { usePalette } from "../../src/ui/theme";
import { SPACE } from "../../src/ui/type";

function Group({ children }: { children: ReactNode }) {
	const palette = usePalette();
	return (
		<View
			style={{
				marginHorizontal: SPACE.l,
				borderRadius: 16,
				overflow: "hidden",
				backgroundColor: palette.surfaceContainer,
			}}
		>
			{children}
		</View>
	);
}

/** The workspace switcher, the account, the server and sign-out. */
export default function MoreScreen() {
	const palette = usePalette();
	const me = useMe();
	const { origin, slug } = useWorkspace();
	const { setWorkspace, signOut } = useSession();

	const confirmSignOut = () =>
		Alert.alert(
			"Sign out?",
			`The app forgets ${origin} and your sign-in on this phone.`,
			[
				{ text: "Cancel", style: "cancel" },
				{
					text: "Sign out",
					style: "destructive",
					onPress: () => void signOut(),
				},
			],
		);

	return (
		<Screen title="More">
			{me.isPending ? (
				<Inset>
					<Skeleton height={56} />
					<Skeleton height={56} />
				</Inset>
			) : me.isError ? (
				<ErrorState error={me.error} onRetry={() => void me.refetch()} />
			) : (
				<>
					<SectionHeader>Workspace</SectionHeader>
					<Group>
						{me.data.organizations.map((org) => (
							<ListRow
								key={org.slug}
								icon="workspace"
								title={org.name}
								subtitle={org.slug}
								selected={org.slug === slug}
								onPress={() => void setWorkspace(org.slug)}
								trailing={
									org.slug === slug ? (
										<Icon name="check" size={20} color={palette.primary} />
									) : undefined
								}
							/>
						))}
					</Group>
					<SectionHeader>Account</SectionHeader>
					<Group>
						<ListRow
							icon="person"
							title={me.data.user.name}
							subtitle={me.data.user.email}
						/>
					</Group>
				</>
			)}
			<SectionHeader>Server</SectionHeader>
			<Group>
				<ListRow icon="server" title={origin} subtitle="Server address" />
				<ListRow
					icon="web"
					title="Open Farmer on the web"
					onPress={() => void Linking.openURL(origin)}
				/>
			</Group>
			<SectionHeader>App</SectionHeader>
			<Group>
				<ListRow icon="info" title="Version" subtitle={APP_VERSION} />
				<ListRow icon="signOut" title="Sign out" onPress={confirmSignOut} />
			</Group>
		</Screen>
	);
}
