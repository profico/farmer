import type { UpdateIntegrationSettingsInput } from "@farmer/core/schema";
import {
	useMutation,
	useQuery,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Building2, Calendar, Github } from "lucide-react";
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
import { Switch } from "#/components/ui/switch.tsx";
import { authClient } from "#/lib/auth-client.ts";
import {
	githubConnectionStatusQuery,
	githubInstallationsQuery,
} from "#/queries/github.ts";
import { googleCalendarStatusQuery } from "#/queries/google-calendar.ts";
import { integrationSettingsQuery } from "#/queries/integration-settings.ts";
import {
	disconnectGithubInstallation,
	getGithubInstallUrl,
} from "#/server/github.ts";
import { syncGoogleMeetings } from "#/server/google-calendar.ts";
import { updateIntegrationSettings } from "#/server/integration-settings.ts";

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
		<div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/40 px-3 py-2.5">
			<div className="min-w-0">
				<span className="text-sm font-medium">{title}</span>
				<p className="text-xs text-muted-foreground">{description}</p>
			</div>
			<Switch
				checked={checked}
				onCheckedChange={(value) => mutation.mutate(value)}
				disabled={mutation.isPending}
			/>
		</div>
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
		<div className="page-shell">
			<h1 className="font-display text-xl">Integrations</h1>
			<p className="mt-1 text-sm text-muted-foreground">
				Connect external accounts to enrich your time entries.
			</p>

			{/* GitHub — personal identity, per-user toggles, and org installations */}
			<div className="-mx-4 mt-8 border-t px-4 pt-6 sm:-mx-8 sm:px-8">
				<div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
					<div className="flex items-center gap-3">
						<Github className="size-5" />
						<div>
							<div className="flex items-center gap-2 text-sm font-semibold">
								GitHub
								{status.connected && (
									<Badge variant="secondary">
										Connected{status.login ? ` as ${status.login}` : ""}
									</Badge>
								)}
							</div>
							<p className="mt-1 text-xs text-muted-foreground">
								Identifies you so commits you author can be matched to your time
								entries.
							</p>
						</div>
					</div>
					{status.connected ? (
						<AlertDialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
							<AlertDialogTrigger
								render={<Button variant="outline">Disconnect</Button>}
							/>
							<AlertDialogContent>
								<AlertDialogHeader>
									<AlertDialogTitle>Disconnect GitHub?</AlertDialogTitle>
									<AlertDialogDescription>
										Commits will no longer be matched to you when logging time.
										You can reconnect at any time.
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
					)}
				</div>

				{status.connected && (
					<div className="mt-4 flex flex-col gap-2.5">
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
					</div>
				)}

				{/* Per-org GitHub App installations — repo & commit access */}
				{isAdmin && (
					<OrgInstallationsSection personalConnected={status.connected} />
				)}
			</div>

			{/* Google Calendar — meeting autofill, per-user sync toggles */}
			<div className="-mx-4 mt-6 border-t px-4 pt-6 sm:-mx-8 sm:px-8">
				<div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
					<div className="flex items-center gap-3">
						<Calendar className="size-5" />
						<div>
							<div className="flex items-center gap-2 text-sm font-semibold">
								Google Calendar
								{googleStatus.connected && (
									<Badge variant="secondary">
										Connected
										{googleStatus.email ? ` as ${googleStatus.email}` : ""}
									</Badge>
								)}
							</div>
							<p className="mt-1 text-xs text-muted-foreground">
								Lets you pick a meeting from your calendar when logging time —
								it autofills the start/end and captures the join link.
							</p>
						</div>
					</div>
					{googleStatus.connected ? (
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
					)}
				</div>

				{googleStatus.connected && (
					<div className="mt-4 flex flex-col gap-2.5">
						<SettingToggleRow
							title="Auto-sync meetings as blocks"
							description="Automatically turn calendar meetings into time blocks on your day — no manual load needed."
							checked={settings.googleAutoSyncMeetings}
							patch={(value) => ({ googleAutoSyncMeetings: value })}
						/>
						<SettingToggleRow
							title="Sync approved time off to Google"
							description="When a time-off request is approved, add an all-day event to your Google Calendar."
							checked={settings.googleSyncTimeOff}
							patch={(value) => ({ googleSyncTimeOff: value })}
						/>
						<div className="flex flex-col items-start gap-3 rounded-lg border bg-muted/40 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
							<div className="min-w-0">
								<span className="text-sm font-medium">Sync now</span>
								<p className="text-xs text-muted-foreground">
									Import and reconcile your calendar meetings right now, without
									waiting for the next automatic sync.
								</p>
							</div>
							<Button
								variant="outline"
								onClick={() => syncMeetingsMutation.mutate()}
								disabled={syncMeetingsMutation.isPending}
							>
								{syncMeetingsMutation.isPending ? "Syncing…" : "Sync now"}
							</Button>
						</div>
					</div>
				)}
			</div>
		</div>
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
		<div className="mt-5 rounded-lg border bg-muted/20 p-4">
			<div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
				<div className="flex items-center gap-3">
					<Building2 className="size-5" />
					<div>
						<div className="text-sm font-semibold">
							Organization GitHub accounts
						</div>
						<p className="mt-1 text-xs text-muted-foreground">
							Install the app on the GitHub personal or organization accounts
							whose repositories your team should be able to link to projects.
						</p>
					</div>
				</div>
				<Button
					variant="outline"
					onClick={handleConnectOrg}
					disabled={!personalConnected}
				>
					Connect a GitHub account
				</Button>
			</div>

			{!personalConnected && (
				<p className="mt-3 text-xs text-muted-foreground">
					Connect your own GitHub account above first — it authorizes which
					installations you can attach.
				</p>
			)}

			{installations && installations.length > 0 && (
				<div className="mt-4 overflow-hidden rounded-md border">
					{installations.map((inst) => (
						<div
							key={inst.id}
							className="flex items-center justify-between gap-2 border-b px-3 py-2.5 last:border-b-0"
						>
							<span className="flex min-w-0 items-center gap-2 text-sm">
								<Github className="size-4 shrink-0 text-muted-foreground" />
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
		</div>
	);
}
