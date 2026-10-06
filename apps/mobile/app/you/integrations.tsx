import type { Integrations, SyncResult } from "@farmer/api-client";
import { useRouter } from "expo-router";
import { Linking } from "react-native";

import { useAccess } from "../../src/api/capabilities";
import { useWorkspace } from "../../src/api/queries";
import { useSyncNow } from "../../src/api/time";
import {
	type Provider,
	useDisconnect,
	useIntegrations,
	useUpdateIntegrationSettings,
} from "../../src/api/you";
import { ErrorBanner, ErrorState } from "../../src/ui/components";
import { showDialog } from "../../src/ui/dialog";
import { messageOf } from "../../src/ui/errors";
import { Inset } from "../../src/ui/screen";
import {
	SettingsLink,
	SettingsSection,
	SettingsSwitch,
	SettingsValue,
} from "../../src/ui/settings-list";
import { ListSkeleton, YouScreen } from "../../src/you/components/you-screen";

const NAMES = { github: "GitHub", googleCalendar: "Google Calendar" } as const;

/** What a sync did, in one sentence. Each automation can run, fail, find
 *  its window closed or be off, so "Synced" is only one of five answers. */
const syncMessage = (result: SyncResult) => {
	if (result.stillRunning) {
		return "The sync takes longer than usual and continues on the server. You can continue to work.";
	}
	if (result.failed.length > 0) {
		return `Part of the sync failed: ${result.failed.join(", ")}.`;
	}
	if (result.ran.length === 0 && result.off.length > 0) {
		return `Nothing to sync, because ${result.off.join(" and ")} is off.`;
	}
	if (result.ran.length === 0) return "Nothing to sync now.";
	return "Synced.";
};

const githubStatus = (github: Integrations["github"]) => {
	if (github.needsReconnect) {
		return {
			value: "Reconnect needed",
			line: "GitHub does not accept this connection now, so your commits and pull requests do not reach your time entries. Connect again to repair it. You lose nothing.",
		};
	}
	if (github.unreachable) {
		return {
			value: "Not answering",
			line: "Your account is still linked, but GitHub does not answer now. The sync starts again by itself when GitHub answers.",
		};
	}
	if (github.connected) {
		return {
			value: github.login ? `Connected as ${github.login}` : "Connected",
			line: "Commits and pull requests you write or review are matched to your time entries. With the sync on, each pull request you review gets a 30-minute Code Review block.",
		};
	}
	return {
		value: "Not connected",
		line: "Connect GitHub to match the commits and pull requests you write or review to your time entries.",
	};
};

const googleStatus = (google: Integrations["googleCalendar"]) => {
	if (google.unreachable) {
		return {
			value: "Not answering",
			line: "Your account is still linked, but Google does not answer now. The sync starts again by itself when Google answers.",
		};
	}
	if (google.connected) {
		return {
			value: google.email ? `Connected as ${google.email}` : "Connected",
			line: "Your meetings can become time entries.",
		};
	}
	return {
		value: "Not connected",
		line: "Connect Google Calendar to turn your meetings into time entries.",
	};
};

/**
 * The accounts a person connects as themselves: GitHub and Google
 * Calendar. A connection needs the provider's consent in the browser, so
 * "Connect" opens this page of Farmer on the web. The status here is read
 * again when the person comes back to the app.
 */
export default function IntegrationsScreen() {
	const router = useRouter();
	const access = useAccess();
	const { origin, slug } = useWorkspace();
	const integrations = useIntegrations();
	const update = useUpdateIntegrationSettings();
	const disconnect = useDisconnect();
	const sync = useSyncNow();
	const failure = messageOf(update.error ?? disconnect.error ?? sync.error);

	const openWeb = () =>
		void Linking.openURL(`${origin}/${slug}/settings/integrations`);

	const confirmDisconnect = (provider: Provider) => {
		const name = NAMES[provider];
		showDialog(
			`Disconnect ${name}?`,
			provider === "github"
				? "Commits and pull requests are no longer matched to you when you log time. You can connect again at any time."
				: "Your meetings no longer become time entries. You can connect again at any time.",
			[
				{ text: "Cancel", style: "cancel" },
				{
					text: "Disconnect",
					style: "destructive",
					onPress: () => disconnect.mutate(provider),
				},
			],
		);
	};

	const syncNow = () =>
		sync.mutate(undefined, {
			onSuccess: (result) => showDialog("Sync now", syncMessage(result)),
		});

	if (integrations.isPending) {
		return (
			<YouScreen title="Integrations">
				<ListSkeleton rows={5} />
			</YouScreen>
		);
	}
	if (integrations.isError) {
		return (
			<YouScreen title="Integrations">
				<ErrorState
					error={integrations.error}
					onRetry={() => void integrations.refetch()}
				/>
			</YouScreen>
		);
	}

	const { github, googleCalendar, settings } = integrations.data;
	const gh = githubStatus(github);
	const google = googleStatus(googleCalendar);
	const webFooter =
		"You connect an account in Farmer on the web. It finishes in the browser. Then come back, and this screen shows the connection.";

	return (
		<YouScreen
			title="Integrations"
			refreshing={integrations.isRefetching}
			onRefresh={() => void integrations.refetch()}
		>
			{failure ? (
				<Inset>
					<ErrorBanner message={failure} />
				</Inset>
			) : null}

			<SettingsSection
				title="GitHub"
				footer={
					github.connected && !github.needsReconnect
						? gh.line
						: `${gh.line} ${webFooter}`
				}
			>
				<SettingsValue
					icon="link"
					tint="gray"
					title="GitHub"
					subtitle={gh.value}
					value=""
				/>
				{github.needsReconnect || !github.connected ? (
					<SettingsLink
						title={
							github.needsReconnect ? "Reconnect GitHub" : "Connect GitHub"
						}
						external
						onPress={openWeb}
					/>
				) : null}
				{github.connected && !github.needsReconnect ? (
					<SettingsSwitch
						title="Auto-load commits"
						subtitle="Show the commits of the day when you add a block."
						value={settings.githubAutoLoadCommits}
						onValueChange={(githubAutoLoadCommits) =>
							update.mutate({ githubAutoLoadCommits })
						}
					/>
				) : null}
				{github.connected && !github.needsReconnect ? (
					<SettingsSwitch
						title="Sync commits as work time"
						subtitle="Log a work block on days with commits or pull request work."
						value={settings.githubSyncCommitsAsWorkTime}
						onValueChange={(githubSyncCommitsAsWorkTime) =>
							update.mutate({ githubSyncCommitsAsWorkTime })
						}
					/>
				) : null}
				{github.connected ? (
					<SettingsLink
						title="Disconnect GitHub"
						destructive
						onPress={() => confirmDisconnect("github")}
					/>
				) : null}
			</SettingsSection>

			<SettingsSection
				title="Google Calendar"
				footer={
					googleCalendar.connected ? google.line : `${google.line} ${webFooter}`
				}
			>
				<SettingsValue
					icon="calendar"
					tint="blue"
					title="Google Calendar"
					subtitle={google.value}
					value=""
				/>
				{googleCalendar.connected ? null : (
					<SettingsLink
						title="Connect Google Calendar"
						external
						onPress={openWeb}
					/>
				)}
				{googleCalendar.connected ? (
					<SettingsSwitch
						title="Auto-sync meetings as entries"
						subtitle="Turn meetings into entries, rounded to 15 minutes."
						value={settings.googleAutoSyncMeetings}
						onValueChange={(googleAutoSyncMeetings) =>
							update.mutate({ googleAutoSyncMeetings })
						}
					/>
				) : null}
				{googleCalendar.connected ? (
					<SettingsLink
						title="Sync now"
						subtitle="Import your meetings now, before the next automatic sync."
						value={sync.isPending ? "Syncing" : undefined}
						onPress={sync.isPending ? () => {} : syncNow}
					/>
				) : null}
				{googleCalendar.connected ? (
					<SettingsLink
						title="Disconnect Google Calendar"
						destructive
						onPress={() => confirmDisconnect("googleCalendar")}
					/>
				) : null}
			</SettingsSection>
			{access.isAdmin ? (
				<SettingsSection
					title="Related"
					footer="GitHub accounts for repositories and Slack connect for the whole workspace."
				>
					<SettingsLink
						icon="integration"
						tint="teal"
						title="Workspace integrations"
						onPress={() => router.push("/workspace/integrations")}
					/>
				</SettingsSection>
			) : null}
		</YouScreen>
	);
}
