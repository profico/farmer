import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { View } from "react-native";

import { useMeta, useServerFeatures } from "../api/capabilities";
import { useMyImportClaims, useMyInvitations } from "../api/onboarding";
import { useSession, useSignedIn } from "../session/session";
import { Card, Text } from "../ui/components";
import { Icon } from "../ui/icon";
import { Inset, Screen } from "../ui/screen";
import { SettingsLink, SettingsSection } from "../ui/settings-list";
import { usePalette } from "../ui/theme";
import { SPACE } from "../ui/type";
import { ListSkeleton } from "../workspace/components";
import { PendingList } from "./pending-list";

/**
 * The screen of a signed-in person who is a member of no workspace on this
 * Server, in place of the tabs. As the web's page for this case, it shows
 * the invitations and the Harvest claims that wait for the person, else
 * how to get an invitation. A join opens the workspace, and the tabs come
 * back. A Server before API version 3 has none of these routes, so there
 * the screen only says to ask for an invitation.
 */
export function NoWorkspace({ email }: { email: string }) {
	const router = useRouter();
	const palette = usePalette();
	const queryClient = useQueryClient();
	const { origin } = useSignedIn();
	const { signOut } = useSession();
	const meta = useMeta();
	const { setupApi, workspaceCreation } = useServerFeatures();
	const invitations = useMyInvitations();
	const claims = useMyImportClaims();

	const loading =
		meta.isPending || (setupApi && (invitations.isPending || claims.isPending));
	const pending =
		(invitations.data?.length ?? 0) + (claims.data?.length ?? 0) > 0;

	return (
		<Screen
			title="No workspace yet"
			refreshing={invitations.isRefetching || claims.isRefetching}
			onRefresh={() =>
				void queryClient.refetchQueries({
					queryKey: ["farmer", origin, "me"],
				})
			}
		>
			<Inset>
				<Text variant="bodyLarge" color={palette.onSurfaceVariant}>
					{`You are signed in, but ${email} is not a member of a workspace on this server yet.`}
				</Text>
			</Inset>
			{loading ? (
				<ListSkeleton rows={2} />
			) : pending ? (
				<PendingList />
			) : (
				<Inset>
					<Card>
						<View
							style={{
								flexDirection: "row",
								gap: SPACE.m,
								alignItems: "flex-start",
							}}
						>
							<Icon
								name="invitation"
								size={24}
								color={palette.onSurfaceVariant}
							/>
							<View style={{ flex: 1 }}>
								<Text variant="bodyMedium">
									{`Ask an administrator to invite ${email}. The invitation arrives by email, and in Slack when the workspace has Slack connected.`}
								</Text>
							</View>
						</View>
					</Card>
				</Inset>
			)}
			{workspaceCreation ? (
				<SettingsSection footer="Make a workspace of your own. You are its owner.">
					<SettingsLink
						icon="add"
						tint="green"
						title="New workspace"
						onPress={() => router.push("/onboarding/new-workspace")}
					/>
				</SettingsSection>
			) : null}
			<SettingsSection title="Wrong account?">
				<SettingsLink
					icon="signOut"
					tint="red"
					title="Sign out"
					destructive
					onPress={() => void signOut()}
				/>
			</SettingsSection>
		</Screen>
	);
}
