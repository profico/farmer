import { matchesSearch } from "@farmer/core/lib/search";
import {
	MAX_SYSTEM_PROMPT_CHARS,
	type UpdateIntegrationSettingsInput,
} from "@farmer/core/schema";
// Type-only, so it is erased: a runtime import of the services barrel in a
// route reaches `postgres` and crashes hydration.
import type { UninstallOutcome } from "@farmer/core/services";
import {
	BuildingsIcon,
	CalendarBlankIcon,
	GithubLogoIcon,
	PlugsConnectedIcon,
	SlackLogoIcon,
	SparkleIcon,
	TerminalWindowIcon,
} from "@phosphor-icons/react";
import {
	useMutation,
	useQuery,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
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
	Combobox,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxItem,
	ComboboxList,
	ComboboxTrigger,
	ComboboxValue,
} from "#/components/ui/combobox.tsx";
import { Input } from "#/components/ui/input.tsx";
import {
	Page,
	PageHeader,
	PageSection,
	SettingList,
	SettingRow,
} from "#/components/ui/page-header.tsx";
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
	const { role, assistantEnabled, mcpEnabled, cliEnabled, appOrigin } =
		Route.useRouteContext();
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
				eyebrow={<SettingsEyebrow />}
				title="Integrations"
				lede="Connect external accounts to enrich your time entries."
			/>

			{/* GitHub — personal identity, per-user toggles, and org installations */}
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

			{/* MCP — everyone, not admins only. Unlike the three above it there is
			    nothing here to connect on the workspace's behalf: the connection is
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

type ModelItem = { value: string; label: string };

/**
 * The default-model picker.
 *
 * OpenRouter answers with hundreds of tool-capable models, so this is the same
 * searching Combobox the project and task pickers use rather than a Select
 * nobody can scan. The search covers the model id as well as its name: a
 * provider is spelled one way there ("anthropic/", "google/") and several ways
 * in the names, so the id is what somebody types to see one vendor's list.
 *
 * The stored model is added to the list when the catalogue does not have it —
 * while the catalogue is still loading, and for a model OpenRouter has since
 * retired. The trigger then shows the raw id, which is what is actually saved.
 */
function ModelPicker({
	models,
	value,
	onValueChange,
	disabled,
}: {
	models: { id: string; name: string }[];
	/** The stored model id, or "" before one is chosen. */
	value: string;
	onValueChange: (modelId: string) => void;
	disabled?: boolean;
}) {
	const items = useMemo<ModelItem[]>(() => {
		const known = models.map((model) => ({
			value: model.id,
			label: model.name,
		}));
		if (value === "" || known.some((item) => item.value === value))
			return known;
		return [{ value, label: value }, ...known];
	}, [models, value]);

	const [query, setQuery] = useState("");
	const filtered = useMemo(() => {
		if (query.trim() === "") return items;
		return items.filter((item) =>
			matchesSearch(query, [item.label, item.value]),
		);
	}, [items, query]);

	const selected = items.find((item) => item.value === value) ?? null;

	return (
		<Combobox
			items={items}
			filteredItems={filtered}
			value={selected}
			onValueChange={(item: ModelItem | null) => {
				if (item) onValueChange(item.value);
			}}
			isItemEqualToValue={(a: ModelItem, b: ModelItem) => a.value === b.value}
			itemToStringLabel={(item: ModelItem) => item.label}
			inputValue={query}
			onInputValueChange={setQuery}
			onOpenChange={(open) => {
				if (!open) setQuery("");
			}}
			autoHighlight
			disabled={disabled}
		>
			<ComboboxTrigger className="w-64" aria-label="Default model">
				<ComboboxValue placeholder="Pick a model">
					{(item: ModelItem | null) =>
						item ? (
							<span className="truncate">{item.label}</span>
						) : (
							"Pick a model"
						)
					}
				</ComboboxValue>
			</ComboboxTrigger>
			<ComboboxContent searchPlaceholder="Search models…">
				<ComboboxEmpty>No model matches.</ComboboxEmpty>
				<ComboboxList>
					{(item: ModelItem) => (
						<ComboboxItem key={item.value} value={item}>
							<span className="truncate">{item.label}</span>
						</ComboboxItem>
					)}
				</ComboboxList>
			</ComboboxContent>
		</Combobox>
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
						description="What a new conversation starts on. Only models that support tool calling are listed. The quality and output of the model will determine how the assistant responds."
						action={
							<ModelPicker
								models={models}
								value={settings?.defaultModel ?? ""}
								onValueChange={(modelId) => setModel.mutate(modelId)}
								disabled={setModel.isPending}
							/>
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
		mutationFn: (input: { installationRowId: string; uninstall: boolean }) =>
			disconnectGithubInstallation({ data: input }),
		onSuccess: async ({ uninstall }) => {
			await queryClient.invalidateQueries({
				queryKey: githubInstallationsQuery(orgSlug).queryKey,
			});
			// The workspace is disconnected either way — that half already
			// succeeded, so it is never an error toast. What varies is what became
			// of the App on GitHub, and four of the six answers are things the
			// admin has to know to finish the job themselves.
			const note = uninstallNotes[uninstall];
			if (note)
				toast.warning("GitHub account disconnected", { description: note });
			else toast.success("GitHub account disconnected");
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
						<InstallationRow
							key={inst.id}
							accountLogin={inst.accountLogin}
							accountType={inst.accountType}
							disabled={disconnectMutation.isPending}
							onDisconnect={(uninstall) =>
								disconnectMutation.mutate({
									installationRowId: inst.id,
									uninstall,
								})
							}
						/>
					))}
				</div>
			)}
		</>
	);
}

// What to say about the "also uninstall" half when it did not simply happen.
// Every outcome is named and `null` is an explicit answer, rather than a
// partial map with a lookup that misses: a new outcome then fails to compile
// here, which is the one place that has to have a sentence for it.
//
// `uninstalled` and `already-gone` both mean the App is off the account, so
// neither needs one — the plain success toast is the whole story.
const uninstallNotes = {
	"not-requested": null,
	uninstalled: null,
	"already-gone": null,
	shared:
		"The app was left installed on GitHub: another workspace is still connected to it.",
	"not-configured":
		"The app was left installed on GitHub: this deployment holds no GitHub App credentials.",
	failed:
		"The app was left installed on GitHub — GitHub refused the request. Remove it from GitHub settings.",
} satisfies Record<UninstallOutcome, string | null>;

// One row, and its own dialog, because the "also uninstall" switch is per row:
// a single piece of state in the parent would be shared by every installation's
// dialog, and the one an admin ticked would still be ticked for the next.
function InstallationRow({
	accountLogin,
	accountType,
	disabled,
	onDisconnect,
}: {
	accountLogin: string;
	accountType: string;
	disabled: boolean;
	onDisconnect: (uninstall: boolean) => void;
}) {
	const [uninstall, setUninstall] = useState(false);

	return (
		<div className="flex items-center justify-between gap-2 border-b border-line2 py-2.5 last:border-b-0">
			<span className="flex min-w-0 items-center gap-2 text-sm">
				<GithubLogoIcon className="size-4 shrink-0 text-muted-foreground" />
				<span className="truncate font-medium">{accountLogin}</span>
				<Badge variant="outline" className="shrink-0 capitalize">
					{accountType}
				</Badge>
			</span>
			<AlertDialog
				// Reset on close, so a cancelled dialog does not reopen pre-armed with
				// the heavier of the two acts.
				onOpenChange={(open) => {
					if (!open) setUninstall(false);
				}}
			>
				<AlertDialogTrigger
					render={
						<Button
							variant="ghost"
							size="sm"
							className="shrink-0"
							disabled={disabled}
						>
							Disconnect
						</Button>
					}
				/>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Disconnect {accountLogin}?</AlertDialogTitle>
						<AlertDialogDescription>
							Projects linked to repositories from this account will stop
							suggesting commits. The app stays installed on GitHub unless you
							also remove it below.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<div className="flex items-start justify-between gap-4 rounded-lg border border-line2 p-3">
						<div className="min-w-0">
							<p className="text-sm font-medium">
								Also remove the app from GitHub
							</p>
							<p className="text-sm text-faint">
								Uninstalls it from {accountLogin} for everyone, not just this
								workspace. Skipped if another workspace is still connected to
								it.
							</p>
						</div>
						<Switch
							checked={uninstall}
							onCheckedChange={setUninstall}
							className="mt-0.5 shrink-0"
						/>
					</div>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							onClick={() => onDisconnect(uninstall)}
						>
							{uninstall ? "Disconnect and uninstall" : "Disconnect"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
