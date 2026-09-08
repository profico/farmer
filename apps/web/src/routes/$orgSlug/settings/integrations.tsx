import {
	MAX_SYSTEM_PROMPT_CHARS,
	type UpdateIntegrationSettingsInput,
} from "@farmer/core/schema";
import {
	BuildingsIcon,
	CalendarBlankIcon,
	GithubLogoIcon,
	SlackLogoIcon,
	SparkleIcon,
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
import { Input } from "#/components/ui/input.tsx";
import {
	Page,
	PageHeader,
	PageSection,
	SettingList,
	SettingRow,
} from "#/components/ui/page-header.tsx";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select.tsx";
import { Switch } from "#/components/ui/switch.tsx";
import { Textarea } from "#/components/ui/textarea.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { authClient } from "#/lib/auth-client.ts";
import {
	assistantModelsQuery,
	assistantSettingsQuery,
} from "#/queries/assistant.ts";
import {
	githubConnectionStatusQuery,
	githubInstallationsQuery,
} from "#/queries/github.ts";
import { googleCalendarStatusQuery } from "#/queries/google-calendar.ts";
import { integrationSettingsQuery } from "#/queries/integration-settings.ts";
import { queryKeys } from "#/queries/keys.ts";
import { slackStatusQuery } from "#/queries/slack.ts";
import {
	disconnectAssistant,
	setAssistantSettings,
	updateAssistantSettings,
} from "#/server/assistant.ts";
import {
	disconnectGithubInstallation,
	getGithubInstallUrl,
} from "#/server/github.ts";
import { syncGoogleMeetings } from "#/server/google-calendar.ts";
import { updateIntegrationSettings } from "#/server/integration-settings.ts";
import {
	disconnectSlack,
	getSlackInstallUrl,
	sendTestSlackMessage,
	syncSlackIdentities,
} from "#/server/slack.ts";

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
	const { role, assistantEnabled } = Route.useRouteContext();
	const isAdmin = role === "owner" || role === "admin";
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
						status.unreachable ? (
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
						status.unreachable
							? "Your account is still linked — GitHub itself isn't reachable right now, so your username and commit sync are unavailable until it recovers. Nothing to do here; it resumes on its own."
							: "Identifies you so commits you author can be matched to your time entries."
					}
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

				{/* One list, not two stacked ones. `SettingRow` suppresses the top
				    hairline and padding on its first row, so a second adjacent list
				    made the org-installations heading open flush against the toggle
				    above it — the only block on the page not separated like the rest.
				    Sharing the list makes the separation fall out of the idiom. */}
				{(status.connected || isAdmin) && (
					<SettingList className="mt-1">
						{status.connected && (
							<>
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
							</>
						)}

						{/* Per-org GitHub App installations — repo & commit access */}
						{isAdmin && (
							<OrgInstallationsSection personalConnected={status.connected} />
						)}
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

			{/* Slack — workspace-wide rather than per-user, so admins only. It used
			    to be its own top-level sidebar entry, which put one integration
			    somewhere other than the page called Integrations purely because its
			    audience was narrower. Audience is a reason to gate a section, not a
			    reason to move it off the page it belongs to. */}
			{isAdmin && <SlackSection />}

			{/* OpenRouter — one account per org, like Slack, and for the same reason:
			    it is a billing relationship the workspace has, not a grant each
			    person makes. Also behind the deployment's `ASSISTANT_ENABLED`
			    switch: the services refuse to store a key while the feature is off,
			    so offering the form would be offering an action that cannot
			    succeed. */}
			{isAdmin && assistantEnabled && <OpenRouterSection />}
		</Page>
	);
}

/**
 * House rules appended to the assistant's system prompt.
 *
 * Its own row rather than a field in the list above because it is a textarea
 * with a dirty state and an explicit save — the switches beside it write on
 * change, which is wrong for prose somebody is still in the middle of typing.
 */
function HouseRulesRow({ stored }: { stored: string }) {
	const orgSlug = useOrgSlug();
	const queryClient = useQueryClient();
	const [draft, setDraft] = useState(stored);
	// Re-seed when the server's copy changes underneath (another admin, another
	// tab) — but only when the box is clean, so it can't eat what is being typed.
	const [baseline, setBaseline] = useState(stored);
	if (stored !== baseline && draft === baseline) {
		setBaseline(stored);
		setDraft(stored);
	}
	const dirty = draft !== stored;

	const save = useMutation({
		mutationFn: () =>
			updateAssistantSettings({
				// Empty box clears the rules: null is "forget them", where undefined
				// would mean "leave them alone".
				data: { systemPrompt: draft.trim() ? draft.trim() : null },
			}),
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: queryKeys(orgSlug).assistant,
			});
			toast.success("House rules saved");
		},
		onError: (error) => toast.error(error.message ?? "Could not save"),
	});

	return (
		<div className="mt-5 flex flex-col gap-2">
			<div>
				<h3 className="text-sm font-medium">House rules</h3>
				<p className="mt-1 max-w-[68ch] text-sm leading-normal text-muted-foreground">
					Added to the assistant's instructions for everyone in this workspace —
					billing conventions, how you name projects, what to ask before acting.
					It is appended to the built-in instructions, not a replacement for
					them, and the built-in ones win any disagreement.
				</p>
			</div>
			<Textarea
				value={draft}
				onChange={(event) => setDraft(event.target.value)}
				rows={5}
				maxLength={MAX_SYSTEM_PROMPT_CHARS}
				placeholder={
					"e.g. We bill in 30-minute blocks.\nAlways put internal work on the Internal project."
				}
				aria-label="House rules"
			/>
			<div className="flex items-center gap-3">
				<Button
					disabled={!dirty || save.isPending}
					onClick={() => save.mutate()}
				>
					{save.isPending ? "Saving…" : "Save house rules"}
				</Button>
				<span className="text-2xs text-muted-foreground">
					{draft.length} / {MAX_SYSTEM_PROMPT_CHARS}
				</span>
			</div>
		</div>
	);
}

// Admin-only and mounted only for admins: `assistantModelsQuery` sits behind
// `orgAdminMiddleware` (it needs the key), so prefetching it in the route loader
// would 403 for every member. Same shape as SlackSection below.
function OpenRouterSection() {
	const orgSlug = useOrgSlug();
	const queryClient = useQueryClient();
	const { data: settings } = useQuery(assistantSettingsQuery(orgSlug));
	const [apiKey, setApiKey] = useState("");

	const configured = settings?.configured ?? false;

	const invalidate = () =>
		queryClient.invalidateQueries({
			queryKey: queryKeys(orgSlug).assistant,
		});

	// Only once a key exists — the catalogue call authenticates with it, so
	// asking before then is a guaranteed error.
	const { data: models = [] } = useQuery({
		...assistantModelsQuery(orgSlug),
		enabled: configured,
	});

	const connect = useMutation({
		mutationFn: () =>
			setAssistantSettings({
				data: {
					apiKey: apiKey.trim(),
					// A safe, cheap, tool-capable default so the first question works
					// before anyone has thought about models. Changeable right below.
					defaultModel: settings?.defaultModel ?? "openai/gpt-4o-mini",
				},
			}),
		onSuccess: async () => {
			setApiKey("");
			await invalidate();
			toast.success("OpenRouter connected");
		},
		onError: (error) =>
			toast.error(error.message ?? "Could not connect OpenRouter"),
	});

	const setModel = useMutation({
		mutationFn: (defaultModel: string) =>
			updateAssistantSettings({ data: { defaultModel } }),
		onSuccess: async () => {
			await invalidate();
			toast.success("Default model updated");
		},
		onError: (error) => toast.error(error.message ?? "Could not update"),
	});

	const toggle = useMutation({
		mutationFn: (enabled: boolean) =>
			updateAssistantSettings({ data: { enabled } }),
		onSuccess: invalidate,
		onError: (error) => toast.error(error.message ?? "Could not update"),
	});

	const disconnect = useMutation({
		mutationFn: () => disconnectAssistant(),
		onSuccess: async () => {
			await invalidate();
			toast.success("OpenRouter disconnected");
		},
		onError: (error) => toast.error(error.message ?? "Could not disconnect"),
	});

	const modelItems = models.map((model) => ({
		value: model.id,
		label: model.name,
	}));

	return (
		<PageSection>
			<SettingRow
				icon={<SparkleIcon className="size-5" />}
				title="OpenRouter"
				badge={
					configured && (
						<Badge variant="secondary">
							{settings?.enabled ? "Connected" : "Paused"}
						</Badge>
					)
				}
				description="Powers the Assistant. Everyone in the workspace asks through this one account, and every answer is scoped to what that person is allowed to see."
				action={
					configured ? (
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
									<AlertDialogTitle>Disconnect OpenRouter</AlertDialogTitle>
									<AlertDialogDescription>
										The Assistant stops working for everyone in this workspace
										and the stored key is forgotten. Past conversations are kept
										— they belong to the people who had them. Revoke the key
										itself from your OpenRouter dashboard if you want it dead
										everywhere.
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
					) : null
				}
			/>

			<SettingList className="mt-1">
				<SettingRow
					title={configured ? "Replace the API key" : "API key"}
					description={
						configured
							? `Currently ${settings?.keyHint}. Pasting a new one replaces it; the old key is not recoverable from here.`
							: "Create a key at openrouter.ai/keys. It is verified before it is saved, and never shown again afterwards."
					}
					action={
						<div className="flex items-center gap-2">
							<Input
								type="password"
								value={apiKey}
								onChange={(event) => setApiKey(event.target.value)}
								placeholder="sk-or-v1-…"
								autoComplete="off"
								className="w-56"
								aria-label="OpenRouter API key"
							/>
							<Button
								disabled={connect.isPending || apiKey.trim().length < 20}
								onClick={() => connect.mutate()}
							>
								{connect.isPending ? "Checking…" : "Save"}
							</Button>
						</div>
					}
				/>

				{configured && (
					<SettingRow
						title="Default model"
						description="What a new conversation starts on. Only models that support tool calling are listed — the assistant reads your data through tools, and one that ignores them just makes things up."
						action={
							<Select
								value={settings?.defaultModel ?? ""}
								onValueChange={(value) => setModel.mutate(String(value))}
								items={modelItems}
							>
								<SelectTrigger className="w-64">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{modelItems.map((item) => (
										<SelectItem key={item.value} value={item.value}>
											{item.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						}
					/>
				)}

				{configured && (
					<SettingRow
						title="Available to the workspace"
						description="Turn off to take the Assistant away without forgetting the key or anybody's history."
						action={
							<Switch
								checked={settings?.enabled ?? false}
								onCheckedChange={(value) => toggle.mutate(value)}
								disabled={toggle.isPending}
							/>
						}
					/>
				)}
			</SettingList>

			{configured && <HouseRulesRow stored={settings?.systemPrompt ?? ""} />}
		</PageSection>
	);
}

// Admin-only, and mounted only for admins — `slackStatusQuery` hits a server fn
// behind `orgAdminMiddleware`, so putting it in the route loader (which every
// member runs) would 403 for everyone else. Same reason `githubInstallationsQuery`
// is a `useQuery` inside a gated child rather than a loader prefetch.
function SlackSection() {
	const orgSlug = useOrgSlug();
	const queryClient = useQueryClient();
	const { session } = Route.useRouteContext();
	const { data: status, isPending } = useQuery(slackStatusQuery(orgSlug));

	const invalidate = () =>
		queryClient.invalidateQueries({
			queryKey: slackStatusQuery(orgSlug).queryKey,
		});

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

	// Deliberately addressed to the admin pressing the button, not to a person
	// picked from a list. The question this answers is "is the wiring live?", and
	// the only answer worth trusting is one you can see arrive — sending a
	// stranger a message they didn't ask for to find out proves less and costs
	// more. `notify` runs the real reminder path, so a DM landing here means a
	// Tuesday nudge would land too.
	const sendTest = useMutation({
		mutationFn: () =>
			sendTestSlackMessage({ data: { userId: session.user.id } }),
		onSuccess: () => toast.success("Sent — check your Slack DMs"),
		onError: (error) =>
			toast.error(error.message ?? "Could not send the test message"),
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
										This also forgets which Slack account each person maps to.
										It does not remove the app in Slack — do that from Slack if
										you want to fully revoke access.
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
						title="Send a test message"
						description="DMs you through the same path the reminders use. If it arrives, they will too."
						action={
							<Button
								variant="outline"
								disabled={sendTest.isPending}
								onClick={() => sendTest.mutate()}
							>
								{sendTest.isPending ? "Sending…" : "Send test DM"}
							</Button>
						}
					/>
					<SettingRow
						title="Matched people"
						description="People are matched to Slack by email when they join, automatically. Anyone whose work email isn't in the workspace simply doesn't get reminders — nothing breaks. Re-match by hand only if someone joined Slack after joining here."
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
	const orgSlug = useOrgSlug();
	const queryClient = useQueryClient();
	const { data: installations } = useQuery(githubInstallationsQuery(orgSlug));

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
				queryKey: githubInstallationsQuery(orgSlug).queryKey,
			});
			toast.success("GitHub account disconnected");
		},
		onError: (error) => {
			toast.error(error.message ?? "Could not disconnect");
		},
	});

	return (
		// Just another row in the list — literally: a fragment, so these land as
		// children of the caller's `SettingList` and are ruled and padded like every
		// other row. It used to be indented behind a lone `border-l`, an idiom used
		// nowhere else in the app, which read as a stray rule rather than as nesting
		// — it was the only left-hand border on the screen and had no matching
		// right, top or bottom edge to belong to.
		<>
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
		</>
	);
}
