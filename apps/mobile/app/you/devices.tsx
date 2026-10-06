import type { Session } from "@farmer/api-client";
import { useRouter } from "expo-router";

import { useRevokeSession, useSessions } from "../../src/api/account";
import { useAccess } from "../../src/api/capabilities";
import { useSession } from "../../src/session/session";
import { EmptyState, ErrorBanner, ErrorState } from "../../src/ui/components";
import { showDialog } from "../../src/ui/dialog";
import { messageOf } from "../../src/ui/errors";
import { notifyError } from "../../src/ui/notify-error";
import { Inset } from "../../src/ui/screen";
import {
	SettingsLink,
	SettingsSection,
	SettingsValue,
} from "../../src/ui/settings-list";
import { formatInstant } from "../../src/workspace/format";
import {
	sessionIcon,
	sessionRevokeMessage,
	sessionSubtitle,
} from "../../src/you/account";
import { ListSkeleton, YouScreen } from "../../src/you/components/you-screen";

/**
 * Every browser, terminal and phone signed in to the account, as Preferences
 * on the web lists them. A session belongs to the person, so the list is the
 * same in every workspace. Another device is signed out with a confirm. This
 * phone is signed out with "Sign out", which also forgets the token here: the
 * server refuses to end the session of the request.
 */
export default function DevicesScreen() {
	const router = useRouter();
	const access = useAccess();
	const sessions = useSessions();
	const revoke = useRevokeSession();
	const { signOut } = useSession();

	if (!access.accountApi) {
		return (
			<YouScreen title="Signed-in devices">
				<EmptyState
					icon="devices"
					title="This server is too old"
					message="Update Farmer on the server to see the devices that are signed in."
				/>
			</YouScreen>
		);
	}
	if (sessions.isPending) {
		return (
			<YouScreen title="Signed-in devices">
				<ListSkeleton rows={3} />
			</YouScreen>
		);
	}
	if (sessions.isError) {
		return (
			<YouScreen title="Signed-in devices">
				<ErrorState
					error={sessions.error}
					onRetry={() => void sessions.refetch()}
				/>
			</YouScreen>
		);
	}

	const current = sessions.data.find((row) => row.isCurrent);
	const others = sessions.data.filter((row) => !row.isCurrent);

	const confirmRevoke = (row: Session) =>
		showDialog(`Sign out ${row.label}?`, sessionRevokeMessage(row), [
			{ text: "Cancel", style: "cancel" },
			{
				text: "Revoke",
				style: "destructive",
				onPress: () =>
					revoke.mutate(row.id, {
						onError: (error) =>
							notifyError("Could not sign out that device", error),
					}),
			},
		]);

	const confirmSignOut = () =>
		showDialog(
			"Sign out?",
			"The app forgets this server and your sign-in on this phone.",
			[
				{ text: "Cancel", style: "cancel" },
				{
					text: "Sign out",
					style: "destructive",
					onPress: () => void signOut(),
				},
			],
		);

	const row = (session: Session) => (
		<SettingsValue
			key={session.id}
			icon={sessionIcon(session.kind)}
			tint="gray"
			title={session.label}
			subtitle={sessionSubtitle(session, formatInstant)}
			subtitleLines={3}
			value={session.isCurrent ? "" : "Revoke"}
			onPress={session.isCurrent ? undefined : () => confirmRevoke(session)}
			actions={
				session.isCurrent
					? []
					: [
							{
								label: "Sign out",
								icon: "signOut",
								destructive: true,
								onPress: () => confirmRevoke(session),
							},
						]
			}
		/>
	);

	return (
		<YouScreen
			title="Signed-in devices"
			refreshing={sessions.isRefetching}
			onRefresh={() => void sessions.refetch()}
		>
			{revoke.error ? (
				<Inset>
					<ErrorBanner message={messageOf(revoke.error) ?? ""} />
				</Inset>
			) : null}
			{current ? (
				<SettingsSection
					title="This device"
					footer="Your sign-in on this phone. Signing out here also removes it from this app."
				>
					{row(current)}
					<SettingsLink
						icon="signOut"
						tint="red"
						title="Sign out"
						destructive
						onPress={confirmSignOut}
					/>
				</SettingsSection>
			) : null}
			<SettingsSection
				title={current ? "Other devices" : "Devices"}
				footer={
					others.length === 0
						? "No other device is signed in."
						: "Every browser, terminal and phone signed in to your account, in every workspace. Revoke any you do not recognise, or one on a device you no longer have."
				}
			>
				{others.map(row)}
			</SettingsSection>
			<SettingsSection
				title="Related"
				footer="A script or a scheduled job signs in with an API token, and not with a device."
			>
				<SettingsLink
					icon="key"
					tint="gray"
					title="API tokens"
					onPress={() => router.push("/you/api-tokens")}
				/>
			</SettingsSection>
		</YouScreen>
	);
}
