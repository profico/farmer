// Type-only, so it is erased: a runtime import of the services barrel in a
// route reaches `postgres` and crashes hydration.
import type { UninstallOutcome } from "@farmer/core/services";
import {
	BuildingsIcon,
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
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { MenuPath } from "#/components/menu-path.tsx";
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
import {
	githubConnectionStatusQuery,
	githubInstallationsQuery,
} from "#/queries/github.ts";
import { slackStatusQuery } from "#/queries/slack.ts";
import { requireOrgAdmin } from "#/server/auth.ts";
import {
	connectGithubInstallation,
	disconnectGithubInstallation,
	getGithubInstallUrl,
} from "#/server/github.ts";
import {
	disconnectSlack,
	getSlackInstallUrl,
	sendTestSlackMessage,
	syncSlackIdentities,
} from "#/server/slack.ts";

// What the WORKSPACE is connected to, as opposed to what a person is: the
// GitHub accounts whose repositories projects may link, the Slack workspace the
// reminders speak through. Each is
// one relationship per organization, made by an admin — which is why they are
// a page under Workspace rather than sections gated on a shared one: the hub
// already splits every other setting by scope, and this page follows it. A
// person's own connections (their GitHub identity, their calendar, MCP and the
// CLI) stay under Account → Integrations (`integrations.tsx`).

const searchSchema = z.object({
	// A GitHub installation waiting for the admin to confirm it. Set by
	// `api/github/setup` when GitHub came back with no signed state (an App
	// installed from GitHub's own settings, or a crafted link: the route cannot
	// tell them apart), so nothing was connected there.
	githubInstallation: z.number().int().positive().optional().catch(undefined),
});

export const Route = createFileRoute(
	"/$orgSlug/settings/workspace-integrations",
)({
	validateSearch: searchSchema,
	beforeLoad: async () => {
		await requireOrgAdmin();
	},
	loader: async ({ context, params }) => {
		// The admin's own GitHub link is what authorizes installing the App
		// (see OrgInstallationsSection), so the page knows it on arrival.
		await context.queryClient.ensureQueryData(
			githubConnectionStatusQuery(params.orgSlug),
		);
	},
	component: WorkspaceIntegrationsPage,
});

function WorkspaceIntegrationsPage() {
	const orgSlug = useOrgSlug();
	const { assistantEnabled } = Route.useRouteContext();
	const { data: status } = useSuspenseQuery(
		githubConnectionStatusQuery(orgSlug),
	);

	return (
		<Page>
			<PageHeader eyebrow={<SettingsEyebrow />} title="Integrations" />

			{/* Per-org GitHub App installations — repo & commit access */}
			<PageSection>
				<SettingList>
					<OrgInstallationsSection personalConnected={status.connected} />
				</SettingList>
			</PageSection>

			<SlackSection />

			{/* The OpenRouter account has its own page. Behind the deployment's
			    `ASSISTANT_ENABLED` switch, like the page itself. */}
			{assistantEnabled && (
				<PageSection>
					<SettingList>
						<SettingRow
							icon={<SparkleIcon className="size-5" />}
							title="OpenRouter"
							description={
								<>
									The Assistant's key, model and house rules are under{" "}
									<MenuPath steps={["Settings", "AI"]} />.
								</>
							}
							action={
								<Link
									to="/$orgSlug/settings/ai"
									params={{ orgSlug }}
									className="text-sm font-medium hover:underline"
								>
									Open AI settings
								</Link>
							}
						/>
					</SettingList>
				</PageSection>
			)}
		</Page>
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
	// The install row is there but its bot token no longer opens
	// (`BETTER_AUTH_SECRET` changed). Nothing sends, and the reminder job skips
	// the workspace, so this is the one place the admin learns a reinstall is
	// needed. Installing again replaces the token in place.
	const needsReconnect = status?.needsReconnect ?? false;

	return (
		<PageSection>
			<SettingRow
				icon={<SlackLogoIcon className="size-5" />}
				title="Slack"
				badge={
					connected ? (
						<Badge variant="secondary">
							Connected{status?.teamName ? ` to ${status.teamName}` : ""}
						</Badge>
					) : (
						needsReconnect && <Badge variant="destructive">Connect again</Badge>
					)
				}
				description={
					needsReconnect
						? status?.reason === "rejected"
							? `Slack refused the stored credential${status.teamName ? ` for ${status.teamName}` : ""}. The app was removed or its token was revoked. No reminder goes out until Slack is added again.`
							: `The stored Slack credential${status?.teamName ? ` for ${status.teamName}` : ""} can no longer be read, because the server's secret changed after it was saved. No reminder goes out until Slack is added again.`
						: "Sends reminder DMs on Tuesday and Friday, plus a push at the end of the month."
				}
				action={
					connected ? (
						<AlertDialog>
							<AlertDialogTrigger
								render={
									<Button
										variant="outline"
										className="hover:text-destructive"
										disabled={disconnect.isPending}
									>
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
							{needsReconnect ? "Add to Slack again" : "Add to Slack"}
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
						description="People are matched to Slack by email when they join. Anyone without a matching email gets no reminders. Re-match if someone joined Slack later."
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
	const { organization } = Route.useRouteContext();
	const { githubInstallation: pendingInstallationId } = Route.useSearch();
	const navigate = Route.useNavigate();
	const { data: installations } = useQuery(githubInstallationsQuery(orgSlug));

	// Out of the URL once answered, so a reload does not ask again.
	const clearPending = () => navigate({ search: {}, replace: true });

	const connectMutation = useMutation({
		mutationFn: (installationId: number) =>
			connectGithubInstallation({
				data: { installationId, organizationId: organization.id },
			}),
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: githubInstallationsQuery(orgSlug).queryKey,
			});
			await clearPending();
			toast.success("GitHub account connected");
		},
		onError: (error) => {
			toast.error(error.message ?? "Could not connect");
		},
	});

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

			{/* Asked, never done on arrival: the redirect that set this id carries
			    no proof that this admin started the install, only a GET. */}
			{pendingInstallationId !== undefined && (
				<SettingRow
					icon={<GithubLogoIcon className="size-5 text-muted-foreground" />}
					title="Connect this GitHub installation?"
					description={`GitHub sent you back after the app was installed or changed on GitHub (installation ${pendingInstallationId}). Nothing is connected to ${organization.name} until you confirm. Connect it only if you made that change on GitHub yourself.`}
					action={
						<div className="flex items-center gap-2">
							<Button
								variant="ghost"
								disabled={connectMutation.isPending}
								onClick={() => void clearPending()}
							>
								Dismiss
							</Button>
							<Button
								disabled={!personalConnected || connectMutation.isPending}
								onClick={() => connectMutation.mutate(pendingInstallationId)}
							>
								{connectMutation.isPending ? "Connecting…" : "Connect"}
							</Button>
						</div>
					}
				/>
			)}

			{!personalConnected && (
				<p className="pt-3 text-sm text-faint">
					Connect your own GitHub account first, under{" "}
					<Link
						to="/$orgSlug/settings/integrations"
						params={{ orgSlug }}
						className="underlined"
					>
						<MenuPath steps={["Account", "Integrations"]} />
					</Link>{" "}
					— it authorizes which installations you can attach.
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
							className="shrink-0 hover:text-destructive"
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
