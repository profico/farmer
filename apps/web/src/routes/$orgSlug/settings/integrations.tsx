import type { UpdateIntegrationSettingsInput } from "@farmer/core/schema";
import {
	BuildingsIcon,
	CalendarBlankIcon,
	GithubLogoIcon,
	SlackLogoIcon,
} from "@phosphor-icons/react";
import {
	useMutation,
	useQuery,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
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
import { authClient } from "#/lib/auth-client.ts";
import {
	githubConnectionStatusQuery,
	githubInstallationsQuery,
} from "#/queries/github.ts";
import { googleCalendarStatusQuery } from "#/queries/google-calendar.ts";
import { integrationSettingsQuery } from "#/queries/integration-settings.ts";
import { slackStatusQuery } from "#/queries/slack.ts";
import {
	disconnectGithubInstallation,
	getGithubInstallUrl,
} from "#/server/github.ts";
import { syncGoogleMeetings } from "#/server/google-calendar.ts";
import { updateIntegrationSettings } from "#/server/integration-settings.ts";
import {
	disconnectSlack,
	getSlackInstallUrl,
	syncSlackIdentities,
} from "#/server/slack.ts";

export const Route = createFileRoute("/$orgSlug/settings/integrations")({
	loader: async ({ context }) => {
		await Promise.all([
			context.queryClient.ensureQueryData(githubConnectionStatusQuery()),
			context.queryClient.ensureQueryData(googleCalendarStatusQuery()),
			context.queryClient.ensureQueryData(integrationSettingsQuery()),
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
	const queryClient = useQueryClient();
	const mutation = useMutation({
		mutationFn: (value: boolean) =>
			updateIntegrationSettings({ data: patch(value) }),
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: integrationSettingsQuery().queryKey,
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
	const { role } = Route.useRouteContext();
	const isAdmin = role === "owner" || role === "admin";
	const { data: status } = useSuspenseQuery(githubConnectionStatusQuery());
	const { data: googleStatus } = useSuspenseQuery(googleCalendarStatusQuery());
	const { data: settings } = useSuspenseQuery(integrationSettingsQuery());
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
			queryKey: githubConnectionStatusQuery().queryKey,
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
			queryKey: googleCalendarStatusQuery().queryKey,
		});
		toast.success("Google Calendar disconnected");
	};

	// Manual on-demand meeting sync. Reconciles the same window the background
	// scheduler uses, then refreshes any open time-entries view so freshly
	// imported/removed blocks show up without a reload.
	const syncMeetingsMutation = useMutation({
		mutationFn: () => syncGoogleMeetings(),
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ["time-entries"] });
			toast.success("Meetings synced from Google Calendar");
		},
		onError: (error) => {
			toast.error(error.message ?? "Could not sync meetings");
		},
	});

	return (
		<Page className="screen">
			<PageHeader
				eyebrow="Your account"
				title="Integrations"
				lede="Connect external accounts to enrich your time entries."
				className="mb-0"
			/>

			{/* GitHub — personal identity, per-user toggles, and org installations */}
			<PageSection>
				<SettingRow
					icon={<GithubLogoIcon className="size-5" />}
					title="GitHub"
					badge={
						status.connected && (
							<Badge variant="secondary">
								Connected{status.login ? ` as ${status.login}` : ""}
							</Badge>
						)
					}
					description="Identifies you so commits you author can be matched to your time entries."
					action={
						status.connected ? (
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
											Commits will no longer be matched to you when logging
											time. You can reconnect at any time.
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
							description="Show the day's commits automatically in the add-block dialog — no 'Find commits' click."
							checked={settings.githubAutoLoadCommits}
							patch={(value) => ({ githubAutoLoadCommits: value })}
						/>
						<SettingToggleRow
							title="Sync commits as work time"
							description="On days you push commits, automatically log a work block that fills your working hours."
							checked={settings.githubSyncCommitsAsWorkTime}
							patch={(value) => ({ githubSyncCommitsAsWorkTime: value })}
						/>
					</SettingList>
				)}

				{/* Per-org GitHub App installations — repo & commit access */}
				{isAdmin && (
					<OrgInstallationsSection personalConnected={status.connected} />
				)}
			</PageSection>

			{/* Google Calendar — meeting autofill, per-user sync toggles */}
			<PageSection>
				<SettingRow
					icon={<CalendarBlankIcon className="size-5" />}
					title="Google Calendar"
					badge={
						googleStatus.connected && (
							<Badge variant="secondary">
								Connected
								{googleStatus.email ? ` as ${googleStatus.email}` : ""}
							</Badge>
						)
					}
					description="Lets you pick a meeting from your calendar when logging time — it autofills the start/end and captures the join link."
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

			{/* Slack — workspace-wide rather than per-user, so admins only. It used
			    to be its own top-level sidebar entry, which put one integration
			    somewhere other than the page called Integrations purely because its
			    audience was narrower. Audience is a reason to gate a section, not a
			    reason to move it off the page it belongs to. */}
			{isAdmin && <SlackSection />}
		</Page>
	);
}

// Admin-only, and mounted only for admins — `slackStatusQuery` hits a server fn
// behind `orgAdminMiddleware`, so putting it in the route loader (which every
// member runs) would 403 for everyone else. Same reason `githubInstallationsQuery`
// is a `useQuery` inside a gated child rather than a loader prefetch.
function SlackSection() {
	const queryClient = useQueryClient();
	const { data: status, isPending } = useQuery(slackStatusQuery());

	const invalidate = () =>
		queryClient.invalidateQueries({ queryKey: slackStatusQuery().queryKey });

	const handleInstall = async () => {
		try {
			const { url } = await getSlackInstallUrl();
			window.location.href = url;
		} catch (error) {
			toast.error(
				error instanceof Error && error.message.includes("SLACK_CLIENT_ID")
					? "Slack isn't configured on this server yet."
					: "Could not start the Slack install",
			);
		}
	};

	const disconnect = useMutation({
		mutationFn: () => disconnectSlack(),
		onSuccess: async () => {
			await invalidate();
			toast.success("Slack disconnected");
		},
		onError: (error) => toast.error(error.message ?? "Could not disconnect"),
	});

	const resync = useMutation({
		mutationFn: () => syncSlackIdentities(),
		onSuccess: async (mapped) => {
			await invalidate();
			toast.success(
				`Matched ${mapped} ${mapped === 1 ? "person" : "people"} by email`,
			);
		},
		onError: (error) => toast.error(error.message ?? "Could not re-sync"),
	});

	const connected = status?.connected ?? false;

	return (
		<PageSection>
			<SettingRow
				icon={<SlackLogoIcon className="size-5" />}
				title="Slack"
				badge={
					connected && (
						<Badge variant="secondary">
							Connected{status?.teamName ? ` to ${status.teamName}` : ""}
						</Badge>
					)
				}
				description="Sends reminder DMs on Tuesday and Friday, plus a push at the end of the month."
				action={
					connected ? (
						<AlertDialog>
							<AlertDialogTrigger
								render={
									<Button variant="outline" disabled={disconnect.isPending}>
										Disconnect
									</Button>
								}
							/>
							<AlertDialogContent>
								<AlertDialogHeader>
									<AlertDialogTitle>Disconnect Slack</AlertDialogTitle>
									<AlertDialogDescription>
										Nobody in the workspace will receive reminder DMs any more.
										This also forgets which SlackLogoIcon account each person
										maps to. It does not remove the app in SlackLogoIcon — do
										that from SlackLogoIcon if you want to fully revoke access.
									</AlertDialogDescription>
								</AlertDialogHeader>
								<AlertDialogFooter>
									<AlertDialogCancel>Cancel</AlertDialogCancel>
									<AlertDialogAction
										variant="destructive"
										onClick={() => disconnect.mutate()}
									>
										Disconnect
									</AlertDialogAction>
								</AlertDialogFooter>
							</AlertDialogContent>
						</AlertDialog>
					) : (
						<Button onClick={handleInstall} disabled={isPending}>
							Add to Slack
						</Button>
					)
				}
			/>

			{connected && (
				<SettingList className="mt-1">
					<SettingRow
						title="Matched people"
						description="People are matched to Slack by email. Anyone whose work email isn't in the workspace simply doesn't get reminders — nothing breaks. Re-match after someone joins."
						badge={
							<Badge variant="outline">
								{status?.connected ? status.mappedPeople : 0} matched
							</Badge>
						}
						action={
							<Button
								variant="outline"
								disabled={resync.isPending}
								onClick={() => resync.mutate()}
							>
								{resync.isPending ? "Matching…" : "Re-match people"}
							</Button>
						}
					/>
				</SettingList>
			)}
		</PageSection>
	);
}

function OrgInstallationsSection({
	personalConnected,
}: {
	personalConnected: boolean;
}) {
	const queryClient = useQueryClient();
	const { data: installations } = useQuery(githubInstallationsQuery());

	const handleConnectOrg = async () => {
		try {
			const { url } = await getGithubInstallUrl();
			window.location.href = url;
		} catch {
			toast.error("Could not start GitHub app installation");
		}
	};

	const disconnectMutation = useMutation({
		mutationFn: (installationRowId: string) =>
			disconnectGithubInstallation({ data: installationRowId }),
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: githubInstallationsQuery().queryKey,
			});
			toast.success("GitHub account disconnected");
		},
		onError: (error) => {
			toast.error(error.message ?? "Could not disconnect");
		},
	});

	return (
		// Just another row in the list. It used to be indented behind a lone
		// `border-l`, an idiom used nowhere else in the app, which read as a stray
		// rule rather than as nesting — it was the only left-hand border on the
		// screen and had no matching right, top or bottom edge to belong to.
		<SettingList className="mt-1">
			<SettingRow
				icon={<BuildingsIcon className="size-5 text-muted-foreground" />}
				title="Organization GitHub accounts"
				description="Install the app on the GitHub personal or organization accounts whose repositories your team should be able to link to projects."
				action={
					<Button
						variant="outline"
						onClick={handleConnectOrg}
						disabled={!personalConnected}
					>
						Connect a GitHub account
					</Button>
				}
			/>

			{!personalConnected && (
				<p className="pt-3 text-sm text-faint">
					Connect your own GitHub account above first — it authorizes which
					installations you can attach.
				</p>
			)}

			{installations && installations.length > 0 && (
				<div className="border-t border-line2 pt-1">
					{installations.map((inst) => (
						<div
							key={inst.id}
							className="flex items-center justify-between gap-2 border-b border-line2 py-2.5 last:border-b-0"
						>
							<span className="flex min-w-0 items-center gap-2 text-sm">
								<GithubLogoIcon className="size-4 shrink-0 text-muted-foreground" />
								<span className="truncate font-medium">
									{inst.accountLogin}
								</span>
								<Badge variant="outline" className="shrink-0 capitalize">
									{inst.accountType}
								</Badge>
							</span>
							<AlertDialog>
								<AlertDialogTrigger
									render={
										<Button
											variant="ghost"
											size="sm"
											className="shrink-0"
											disabled={disconnectMutation.isPending}
										>
											Disconnect
										</Button>
									}
								/>
								<AlertDialogContent>
									<AlertDialogHeader>
										<AlertDialogTitle>
											Disconnect {inst.accountLogin}?
										</AlertDialogTitle>
										<AlertDialogDescription>
											Projects linked to repositories from this account will
											stop suggesting commits. This does not uninstall the app
											on GitHub — do that from GitHub settings to fully revoke
											access.
										</AlertDialogDescription>
									</AlertDialogHeader>
									<AlertDialogFooter>
										<AlertDialogCancel>Cancel</AlertDialogCancel>
										<AlertDialogAction
											variant="destructive"
											onClick={() => disconnectMutation.mutate(inst.id)}
										>
											Disconnect
										</AlertDialogAction>
									</AlertDialogFooter>
								</AlertDialogContent>
							</AlertDialog>
						</div>
					))}
				</div>
			)}
		</SettingList>
	);
}
