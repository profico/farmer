import { type GithubInstallation } from "@farmer/api-client";
import { Stack, useRouter } from "expo-router";
import { Alert } from "react-native";

import { useAssistantSettings, useAccess } from "../../../src/api/capabilities";
import {
	useDisconnectGithub,
	useDisconnectSlack,
	useGithubInstallUrl,
	useGithubWorkspace,
	useMatchSlackPeople,
	useSlackInstallUrl,
	useSlackStatus,
} from "../../../src/api/workspace";
import { ErrorState } from "../../../src/ui/components";
import { Screen } from "../../../src/ui/screen";
import {
	SettingsLink,
	SettingsSection,
	SettingsValue,
} from "../../../src/ui/settings-list";
import {
	ActionRow,
	Badge,
	confirmDestructive,
	DetailRow,
	ListSkeleton,
	NoteRow,
	notify,
	notifyError,
} from "../../../src/workspace/components";
import { formatInstant, peopleCount } from "../../../src/workspace/format";
import {
	openInstall,
	uninstallNote,
} from "../../../src/workspace/integrations/helpers";

/** What this workspace connects to: GitHub accounts for repositories, Slack
 *  for reminders, and, when the server has it, the assistant. */
export default function WorkspaceIntegrationsScreen() {
	const github = useGithubWorkspace();
	const slack = useSlackStatus();
	const assistant = useAssistantSettings();
	const access = useAccess();
	const router = useRouter();
	return (
		<>
			<Stack.Screen options={{ title: "Integrations" }} />
			<Screen
				topInset={false}
				refreshing={github.isRefetching || slack.isRefetching}
				onRefresh={() => {
					void github.refetch();
					void slack.refetch();
				}}
			>
				<GithubSection />
				<SlackSection />
				{access.isAdmin && assistant.data?.available ? (
					<SettingsSection footer="The model provider for the assistant, and the house rules.">
						<SettingsLink
							icon="assistant"
							title="Assistant"
							onPress={() => router.push("/workspace/assistant")}
						/>
					</SettingsSection>
				) : null}
			</Screen>
		</>
	);
}

function GithubSection() {
	const github = useGithubWorkspace();
	const install = useGithubInstallUrl();
	const data = github.data;

	if (github.isPending) return <ListSkeleton rows={2} />;
	if (!data) {
		return (
			<ErrorState
				error={github.error ?? new Error("GitHub did not load.")}
				onRetry={() => void github.refetch()}
			/>
		);
	}
	return (
		<>
			<SettingsSection
				title="GitHub"
				footer="Install the app on the GitHub personal or organization accounts whose repositories your team should be able to link to projects. The install finishes on the web: sign in to Farmer on the web in the same browser first. Then come back to the app."
			>
				{data.appConfigured ? (
					<ActionRow
						label="Install the GitHub App"
						icon="download"
						busy={install.isPending}
						onPress={() =>
							void openInstall("Could not start the GitHub install", () =>
								install.mutateAsync(),
							)
						}
					/>
				) : (
					<NoteRow>
						This server has no GitHub App, so no account can be connected.
					</NoteRow>
				)}
			</SettingsSection>
			{data.installations.map((installation) => (
				<InstallationSection
					key={installation.id}
					installation={installation}
				/>
			))}
		</>
	);
}

function InstallationSection({
	installation,
}: {
	installation: GithubInstallation;
}) {
	const disconnect = useDisconnectGithub();
	const { accountLogin } = installation;
	const run = (uninstall: boolean) =>
		disconnect.mutate(
			{ id: installation.id, uninstall },
			{
				onSuccess: ({ uninstall: outcome }) => {
					const note = uninstallNote(outcome);
					notify(
						note
							? `GitHub account disconnected. ${note}`
							: "GitHub account disconnected",
					);
				},
				onError: (error) => notifyError("Could not disconnect", error),
			},
		);
	// Two destructive choices, so the dialog has three buttons. The web
	// asks the same question with a switch.
	const ask = () =>
		Alert.alert(
			`Disconnect ${accountLogin}?`,
			"Projects linked to repositories from this account will stop suggesting commits. The app stays installed on GitHub unless you also remove it. Removing it uninstalls it from the account for everyone, not just this workspace. This is skipped if another workspace is still connected to it.",
			[
				{ text: "Cancel", style: "cancel" },
				{
					text: "Disconnect",
					style: "destructive",
					onPress: () => run(false),
				},
				{
					text: "Disconnect and uninstall",
					style: "destructive",
					onPress: () => run(true),
				},
			],
		);
	return (
		<SettingsSection>
			<DetailRow
				title={accountLogin}
				subtitle={`Connected ${formatInstant(installation.connectedAt)}`}
				trailing={<Badge label={installation.accountType} />}
			/>
			<ActionRow
				label={`Disconnect ${accountLogin}`}
				destructive
				busy={disconnect.isPending}
				onPress={ask}
			/>
		</SettingsSection>
	);
}

function SlackSection() {
	const router = useRouter();
	const slack = useSlackStatus();
	const install = useSlackInstallUrl();
	const disconnect = useDisconnectSlack();
	const match = useMatchSlackPeople();
	const status = slack.data;

	if (slack.isPending) return <ListSkeleton rows={3} />;
	if (!status) {
		return (
			<ErrorState
				error={slack.error ?? new Error("Slack did not load.")}
				onRetry={() => void slack.refetch()}
			/>
		);
	}
	const team = status.teamName ? ` for ${status.teamName}` : "";
	const reconnectNote =
		status.reason === "rejected"
			? `Slack refused the stored credential${team}. The app was removed or its token was revoked. No reminder goes out until Slack is added again.`
			: `The stored Slack credential${team} can no longer be read, because the server's secret changed after it was saved. No reminder goes out until Slack is added again.`;
	const startInstall = () =>
		void openInstall("Could not start the Slack install", () =>
			install.mutateAsync(),
		);

	return (
		<SettingsSection
			title="Slack"
			footer={
				status.needsReconnect
					? undefined
					: "Sends reminder messages in Slack. The install finishes on the web: sign in to Farmer on the web in the same browser first. Then come back to the app."
			}
		>
			{!status.appConfigured ? (
				<NoteRow>Slack isn't configured on this server yet.</NoteRow>
			) : null}
			{status.appConfigured && status.needsReconnect ? (
				<>
					<NoteRow>{reconnectNote}</NoteRow>
					<ActionRow
						label="Add to Slack again"
						icon="refresh"
						busy={install.isPending}
						onPress={startInstall}
					/>
				</>
			) : null}
			{status.appConfigured && !status.connected && !status.needsReconnect ? (
				<ActionRow
					label="Add to Slack"
					icon="download"
					busy={install.isPending}
					onPress={startInstall}
				/>
			) : null}
			{status.connected ? (
				<>
					<SettingsValue
						title="Connected to"
						value={status.teamName ?? "Slack"}
					/>
					{status.connectedAt ? (
						<SettingsValue
							title="Connected on"
							value={formatInstant(status.connectedAt)}
						/>
					) : null}
					<SettingsValue
						title="Matched people"
						value={String(status.mappedPeople ?? 0)}
					/>
					<SettingsLink
						icon="person"
						title="Send a test message"
						subtitle="Sends a Slack message through the same path as the reminders. If it arrives, they will too."
						onPress={() => router.push("/workspace/integrations/slack-test")}
					/>
					<ActionRow
						label="Match people"
						icon="refresh"
						subtitle="People are matched to Slack by email when they join. Match again only if someone joined Slack after joining here."
						busy={match.isPending}
						onPress={() =>
							match.mutate(undefined, {
								onSuccess: ({ mapped }) =>
									notify(`Matched ${peopleCount(mapped)} by email`),
								onError: (error) =>
									notifyError("Could not match people", error),
							})
						}
					/>
					<ActionRow
						label="Add to Slack again"
						icon="download"
						busy={install.isPending}
						onPress={startInstall}
					/>
					<ActionRow
						label="Disconnect Slack"
						destructive
						busy={disconnect.isPending}
						onPress={() =>
							confirmDestructive({
								title: "Disconnect Slack",
								message:
									"Nobody in the workspace will receive reminder messages any more. This also forgets which Slack account each person maps to. It does not remove the app in Slack. Do that from Slack if you want to fully revoke access.",
								action: "Disconnect",
								onConfirm: () =>
									disconnect.mutate(undefined, {
										onSuccess: () => notify("Slack disconnected"),
										onError: (error) =>
											notifyError("Could not disconnect", error),
									}),
							})
						}
					/>
				</>
			) : null}
		</SettingsSection>
	);
}
