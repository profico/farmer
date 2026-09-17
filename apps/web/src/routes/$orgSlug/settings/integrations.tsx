import type { UpdateIntegrationSettingsInput } from "@farmer/core/schema";
import {
	CalendarBlankIcon,
	GithubLogoIcon,
	PlugsConnectedIcon,
	TerminalWindowIcon,
} from "@phosphor-icons/react";
import {
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { SettingsEyebrow } from "#/components/settings-nav.tsx";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "#/components/ui/alert-dialog.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
	Page,
	PageHeader,
	PageSection,
	SettingList,
	SettingRow,
} from "#/components/ui/page-header.tsx";
import { Switch } from "#/components/ui/switch.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { authClient } from "#/lib/auth-client.ts";
import { githubConnectionStatusQuery } from "#/queries/github.ts";
import { googleCalendarStatusQuery } from "#/queries/google-calendar.ts";
import { integrationSettingsQuery } from "#/queries/integration-settings.ts";
import { queryKeys } from "#/queries/keys.ts";
import { syncGoogleMeetings } from "#/server/google-calendar.ts";
import { updateIntegrationSettings } from "#/server/integration-settings.ts";

export const Route = createFileRoute("/$orgSlug/settings/integrations")({
	loader: async ({ context, params }) => {
		const orgSlug = params.orgSlug;
		await Promise.all([
			context.queryClient.ensureQueryData(githubConnectionStatusQuery(orgSlug)),
			context.queryClient.ensureQueryData(googleCalendarStatusQuery(orgSlug)),
			context.queryClient.ensureQueryData(integrationSettingsQuery(orgSlug)),
		]);
	},
	component: IntegrationsSettingsPage,
});

// A labelled switch that writes a single integration-settings toggle. Kept
// generic (parent supplies the patch) so there are no computed-key gymnastics
// against the typed input.
function SettingToggleRow({
	title,
	description,
	checked,
	patch,
}: {
	title: string;
	description: string;
	checked: boolean;
	patch: (value: boolean) => UpdateIntegrationSettingsInput;
}) {
	const orgSlug = useOrgSlug();
	const queryClient = useQueryClient();
	const mutation = useMutation({
		mutationFn: (value: boolean) =>
			updateIntegrationSettings({ data: patch(value) }),
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: integrationSettingsQuery(orgSlug).queryKey,
			});
		},
		onError: (error) => {
			toast.error(error.message ?? "Could not update setting");
		},
	});
	return (
		<SettingRow
			title={title}
			description={description}
			action={
				<Switch
					checked={checked}
					onCheckedChange={(value) => mutation.mutate(value)}
					disabled={mutation.isPending}
				/>
			}
		/>
	);
}

function IntegrationsSettingsPage() {
	const orgSlug = useOrgSlug();
	const { mcpEnabled, cliEnabled, appOrigin } = Route.useRouteContext();
	const { data: status } = useSuspenseQuery(
		githubConnectionStatusQuery(orgSlug),
	);
	const { data: googleStatus } = useSuspenseQuery(
		googleCalendarStatusQuery(orgSlug),
	);
	const { data: settings } = useSuspenseQuery(
		integrationSettingsQuery(orgSlug),
	);
	const queryClient = useQueryClient();
	const [disconnectOpen, setDisconnectOpen] = useState(false);
	const [googleDisconnectOpen, setGoogleDisconnectOpen] = useState(false);

	const handleConnect = async () => {
		await authClient.linkSocial({
			provider: "github",
			scopes: ["repo"],
			callbackURL: window.location.href,
		});
	};

	const handleDisconnect = async () => {
		const { error } = await authClient.unlinkAccount({
			providerId: "github",
		});
		setDisconnectOpen(false);
		if (error) {
			toast.error(error.message ?? "Could not disconnect GitHub");
			return;
		}
		await queryClient.invalidateQueries({
			queryKey: githubConnectionStatusQuery(orgSlug).queryKey,
		});
		toast.success("GitHub disconnected");
	};

	const handleConnectGoogle = async () => {
		// Links the dedicated "google-calendar" genericOAuth provider (calendar
		// scope + offline + consent), kept separate from Sign in with Google so
		// this grant is the only thing that marks the calendar as connected.
		await authClient.oauth2.link({
			providerId: "google-calendar",
			callbackURL: window.location.href,
		});
	};

	const handleDisconnectGoogle = async () => {
		const { error } = await authClient.unlinkAccount({
			providerId: "google-calendar",
		});
		setGoogleDisconnectOpen(false);
		if (error) {
			toast.error(error.message ?? "Could not disconnect Google Calendar");
			return;
		}
		await queryClient.invalidateQueries({
			queryKey: googleCalendarStatusQuery(orgSlug).queryKey,
		});
		toast.success("Google Calendar disconnected");
	};

	// Manual on-demand sync. Runs the same pass over the same window the
	// background worker does — every switched-on automation, not just the
	// calendar — then refreshes any open time-entries view so freshly
	// imported/removed blocks show up without a reload.
	//
	// It exists because the worker runs on an interval: somebody who has just
	// connected an account shouldn't have to wait out a tick to find out whether
	// it worked.
	const syncMeetingsMutation = useMutation({
		mutationFn: () => syncGoogleMeetings(),
		onSuccess: async (result) => {
			await queryClient.invalidateQueries({
				queryKey: [...queryKeys(orgSlug).timeEntries],
			});
			// Five real outcomes, and only one of them is "Synced". Each engine is
			// independently best-effort, each can be out of window, and each can
			// simply be switched off — so collapsing the rest into a success tick
			// would be a lie in four different ways. The quietest of them is a pass
			// that ran and touched nothing because every window was closed; the most
			// confusing is a pass that had nothing to run because the switch the
			// person came here for is off.
			if (result.stillRunning) {
				toast.info("Still syncing — this is taking a while, carry on");
			} else if (result.failed.length > 0) {
				toast.warning(`Partly synced — ${result.failed.join(", ")} failed`);
			} else if (result.ran.length === 0 && result.off.length > 0) {
				toast.info(`Nothing to sync — ${result.off.join(" and ")} is off`);
			} else if (result.ran.length === 0) {
				toast.info("Nothing to sync right now");
			} else {
				toast.success("Synced");
			}
		},
		onError: (error) => {
			toast.error(error.message ?? "Could not sync");
		},
	});

	return (
		<Page>
			<PageHeader
				eyebrow={<SettingsEyebrow />}
				title="Integrations"
				lede="Connect external accounts to enrich your time entries."
			/>

			{/* GitHub — personal identity and per-user toggles. The organization's
			    App installations are under Workspace → Integrations. */}
			<PageSection>
				<SettingRow
					icon={<GithubLogoIcon className="size-5" />}
					title="GitHub"
					badge={
						status.needsReconnect ? (
							// Louder than the outage badge on purpose: this one does not end
							// unless the person ends it.
							<Badge variant="destructive">Reconnect needed</Badge>
						) : status.unreachable ? (
							// Two facts, not one: the account is still linked, and GitHub is
							// not answering. Collapsing them into "Connected" hides a real
							// outage, and into "Disconnected" invites someone to reconnect an
							// account that was never disconnected.
							<Badge variant="outline">Connected — GitHub not responding</Badge>
						) : (
							status.connected && (
								<Badge variant="secondary">
									Connected{status.login ? ` as ${status.login}` : ""}
								</Badge>
							)
						)
					}
					description={
						status.needsReconnect
							? "GitHub no longer accepts this connection, so your commits and pull requests have stopped reaching your time entries. That happens when the authorisation is revoked or expires. Connecting again is the whole fix — nothing else is lost."
							: status.unreachable
								? "Your account is still linked — GitHub itself isn't reachable right now, so your username and commit/pull-request sync are unavailable until it recovers. Nothing to do here; it resumes on its own."
								: "Identifies you so commits and pull requests you author or review can be matched to your time entries."
					}
					action={
						status.needsReconnect ? (
							// Straight back through the same grant, no unlink first:
							// better-auth writes the fresh tokens onto the row it already
							// has, and it only refuses when the GitHub account belongs to
							// somebody else. Unlinking first would leave the person
							// disconnected if they abandoned the second leg.
							<Button onClick={handleConnect}>Reconnect GitHub</Button>
						) : status.connected ? (
							<AlertDialog
								open={disconnectOpen}
								onOpenChange={setDisconnectOpen}
							>
								<AlertDialogTrigger
									render={<Button variant="outline">Disconnect</Button>}
								/>
								<AlertDialogContent>
									<AlertDialogHeader>
										<AlertDialogTitle>Disconnect GitHub?</AlertDialogTitle>
										<AlertDialogDescription>
											Commits and pull requests will no longer be matched to you
											when logging time. You can reconnect at any time.
										</AlertDialogDescription>
									</AlertDialogHeader>
									<AlertDialogFooter>
										<AlertDialogCancel>Cancel</AlertDialogCancel>
										<AlertDialogAction
											variant="destructive"
											onClick={handleDisconnect}
										>
											Disconnect
										</AlertDialogAction>
									</AlertDialogFooter>
								</AlertDialogContent>
							</AlertDialog>
						) : (
							<Button onClick={handleConnect}>Connect GitHub</Button>
						)
					}
				/>

				{status.connected && (
					<SettingList className="mt-1">
						<SettingToggleRow
							title="Auto-load commits"
							description="Show the day's commits and pull request activity automatically in the add-block dialog — no 'Find activity' click."
							checked={settings.githubAutoLoadCommits}
							patch={(value) => ({ githubAutoLoadCommits: value })}
						/>
						<SettingToggleRow
							title="Sync commits as work time"
							description="On days you push commits or work on pull requests (open, merge, close or review one), automatically log a work block that fills your working hours. Each pull request you review gets a 30-minute Code Review block of its own."
							checked={settings.githubSyncCommitsAsWorkTime}
							patch={(value) => ({ githubSyncCommitsAsWorkTime: value })}
						/>
					</SettingList>
				)}
			</PageSection>

			{/* Google Calendar — meeting autofill, per-user sync toggles */}
			<PageSection>
				<SettingRow
					icon={<CalendarBlankIcon className="size-5" />}
					title="Google Calendar"
					badge={
						googleStatus.unreachable ? (
							<Badge variant="outline">Connected — Google not responding</Badge>
						) : (
							googleStatus.connected && (
								<Badge variant="secondary">
									Connected
									{googleStatus.email ? ` as ${googleStatus.email}` : ""}
								</Badge>
							)
						)
					}
					description={
						googleStatus.unreachable
							? "Your account is still linked — Google isn't reachable right now, so meeting autofill and calendar sync are unavailable until it recovers. Nothing to do here; it resumes on its own."
							: "Lets you pick a meeting from your calendar when logging time — it autofills the start/end and captures the join link."
					}
					action={
						googleStatus.connected ? (
							<AlertDialog
								open={googleDisconnectOpen}
								onOpenChange={setGoogleDisconnectOpen}
							>
								<AlertDialogTrigger
									render={<Button variant="outline">Disconnect</Button>}
								/>
								<AlertDialogContent>
									<AlertDialogHeader>
										<AlertDialogTitle>
											Disconnect Google Calendar?
										</AlertDialogTitle>
										<AlertDialogDescription>
											You'll no longer be able to autofill meetings from your
											calendar when logging time. You can reconnect at any time.
										</AlertDialogDescription>
									</AlertDialogHeader>
									<AlertDialogFooter>
										<AlertDialogCancel>Cancel</AlertDialogCancel>
										<AlertDialogAction
											variant="destructive"
											onClick={handleDisconnectGoogle}
										>
											Disconnect
										</AlertDialogAction>
									</AlertDialogFooter>
								</AlertDialogContent>
							</AlertDialog>
						) : (
							<Button onClick={handleConnectGoogle}>Connect Google</Button>
						)
					}
				/>

				{googleStatus.connected && (
					<SettingList className="mt-1">
						<SettingToggleRow
							title="Auto-sync meetings as entries"
							description="Turn calendar meetings into time entries automatically, rounded to the nearest 15 minutes."
							checked={settings.googleAutoSyncMeetings}
							patch={(value) => ({ googleAutoSyncMeetings: value })}
						/>
						<SettingRow
							title="Sync now"
							description="Import and reconcile your calendar meetings right now, without waiting for the next automatic sync."
							action={
								<Button
									variant="outline"
									onClick={() => syncMeetingsMutation.mutate()}
									disabled={syncMeetingsMutation.isPending}
								>
									{syncMeetingsMutation.isPending ? "Syncing…" : "Sync now"}
								</Button>
							}
						/>
					</SettingList>
				)}
			</PageSection>

			{/* Slack, the assistant's model provider and the organization's GitHub
			    App installations are relationships the WORKSPACE has, made by an
			    admin, so they live under Workspace → Integrations
			    (`workspace-integrations.tsx`). This page is what a person connects
			    as themselves. */}

			{/* MCP — everyone. There is nothing here to connect on the workspace's
			    behalf: the connection is
			    a person's own, made in their own editor, and authorized as them.
			    This section exists because the URL is otherwise unguessable, and a
			    feature nobody can find is a feature nobody uses. */}
			{mcpEnabled && appOrigin && <McpSection appOrigin={appOrigin} />}

			{/* CLI — everyone, for the same reason as MCP above: the connection is
			    a person's own, signed in from their own terminal as them. Hidden
			    without `appOrigin` too, because every command here names it and a
			    command with a blank where the server goes installs nothing. */}
			{cliEnabled && appOrigin && <CliSection appOrigin={appOrigin} />}
		</Page>
	);
}

/** Copy a command or URL, and say whether it worked. */
const copy = async (value: string, what: string) => {
	try {
		await navigator.clipboard.writeText(value);
		toast.success(`${what} copied`);
	} catch {
		// Denied permission, or an insecure origin. Saying so beats a button
		// that silently does nothing — the string is on screen to select.
		toast.error("Could not copy — select the text instead");
	}
};

/**
 * The MCP connection URL, and the one command that uses it.
 *
 * Read-only on purpose — there is no button here that connects anything. An
 * MCP client authorizes itself: it registers with the authorization server,
 * opens a browser at Google, and holds a token of its own. All this screen can
 * do is say what to paste, which is why it is a copyable string rather than a
 * status row with a "Connect" beside it.
 *
 * The org slug is in the URL because a token has no active workspace to read
 * (see `routes/api/mcp/$orgSlug.ts`), so somebody in two workspaces adds two
 * connectors — which is also why this row names the workspace it is showing
 * rather than saying "your Farmer account".
 */
function McpSection({ appOrigin }: { appOrigin: string }) {
	const orgSlug = useOrgSlug();
	const url = `${appOrigin}/api/mcp/${orgSlug}`;
	const command = `claude mcp add --transport http farmer ${url}`;

	return (
		<PageSection>
			<SettingRow
				icon={<PlugsConnectedIcon className="size-5" />}
				title="Model Context Protocol"
				description="Connect Claude Code, or any MCP client, to this workspace. It gets the same tools the Assistant has and sees exactly what you are allowed to see — your own time entries, the projects you are on, the reports your role allows. Signing in happens in your browser, as you."
			/>

			<SettingList className="mt-1">
				<SettingRow
					title="Server URL"
					description={
						<code className="break-all font-mono text-xs">{url}</code>
					}
					action={
						<Button variant="outline" onClick={() => copy(url, "URL")}>
							Copy
						</Button>
					}
				/>
				<SettingRow
					title="Add it to Claude Code"
					description={
						<code className="break-all font-mono text-xs">{command}</code>
					}
					action={
						<Button variant="outline" onClick={() => copy(command, "Command")}>
							Copy
						</Button>
					}
				/>
			</SettingList>
		</PageSection>
	);
}

/**
 * How to install the command-line tool, and the command that signs it in.
 *
 * Read-only for the same reason as `McpSection`: nothing here connects
 * anything. `farmer login` signs the terminal in through the browser, as the
 * person, on `/device`. This screen only says what to paste.
 *
 * Every command names `appOrigin` rather than the tab's own address. The
 * install script downloads from that origin, and `farmer login` sends the
 * person to approve on it, so a copy taken from a preview URL or an alternate
 * hostname would install from, and sign in to, a server that is not the one
 * the device flow publishes.
 *
 * No org slug, unlike MCP. A CLI login is the person's, not a workspace's: the
 * CLI asks which workspace to use after it signs in, and `--org` switches.
 */
function CliSection({ appOrigin }: { appOrigin: string }) {
	const commands = [
		{
			title: "Install on macOS or Linux",
			command: `curl -fsSL ${appOrigin}/cli | sh`,
		},
		{
			title: "Install on Windows (PowerShell)",
			command: `irm ${appOrigin}/cli | iex`,
		},
		{
			title: "Sign in",
			command: `farmer login ${appOrigin}`,
		},
	];

	return (
		<PageSection>
			<SettingRow
				icon={<TerminalWindowIcon className="size-5" />}
				title="Command-line tool"
				description="Log and read your time from a terminal with the farmer command. The installer signs you in at the end: approve the code in your browser, as you. It sees exactly what you see here."
			/>

			<SettingList className="mt-1">
				{commands.map(({ title, command }) => (
					<SettingRow
						key={title}
						title={title}
						description={
							<code className="break-all font-mono text-xs">{command}</code>
						}
						action={
							<Button
								variant="outline"
								onClick={() => copy(command, "Command")}
							>
								Copy
							</Button>
						}
					/>
				))}
			</SettingList>
		</PageSection>
	);
}
