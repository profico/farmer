import { type Href, useRouter } from "expo-router";
import { Linking } from "react-native";

import {
	type Access,
	useAccess,
	useAssistantAvailable,
} from "../../../src/api/capabilities";
import { usePendingCount } from "../../../src/api/onboarding";
import { useMe, useWhoami, useWorkspace } from "../../../src/api/queries";
import { APP_VERSION } from "../../../src/config";
import { useSession } from "../../../src/session/session";
import { ErrorState, Skeleton } from "../../../src/ui/components";
import { showDialog } from "../../../src/ui/dialog";
import type { IconName } from "../../../src/ui/icons";
import { Inset, Screen } from "../../../src/ui/screen";
import {
	type RowTint,
	SettingsChoice,
	SettingsLink,
	SettingsSection,
	SettingsValue,
} from "../../../src/ui/settings-list";
import { featuredRewindYear } from "../../../src/you/rewind/story";

type Entry = {
	title: string;
	icon: IconName;
	tint: RowTint;
	href: Href;
};

const always = () => true;

/** The pages that are not settings. On the web, each is its own page, not a
 *  row of the settings hub. */
const PAGES: (Entry & {
	allowed: (access: Access) => boolean;
	/** A row that shows in a season only. */
	season?: (today: string) => boolean;
})[] = [
	{
		title: "Absences",
		icon: "absence",
		tint: "red",
		href: "/you/absences",
		allowed: always,
	},
	{
		title: "Rewind",
		icon: "rewind",
		tint: "purple",
		href: "/you/rewind",
		allowed: always,
		// The web shows Rewind in December and January only. The route still
		// opens by a link, as on the web.
		season: (today) => featuredRewindYear(today) !== null,
	},
	{
		title: "Audit log",
		icon: "audit",
		tint: "gray",
		href: "/workspace/audit-log",
		allowed: (access) => access.isAdmin,
	},
];

/** The person's own settings, in the groups and the order of the web's
 *  settings hub (`settings-nav.tsx`). */
const ACCOUNT: Entry[] = [
	{
		title: "Preferences",
		icon: "preferences",
		tint: "gray",
		href: "/you/preferences",
	},
	{
		title: "My schedule",
		icon: "schedule",
		tint: "blue",
		href: "/you/schedule",
	},
	{
		title: "Recurring blocks",
		icon: "repeat",
		tint: "indigo",
		href: "/you/recurring-blocks",
	},
	{
		title: "Integrations",
		icon: "link",
		tint: "teal",
		href: "/you/integrations",
	},
];

/** A row that opens a page of Farmer on the web, under the workspace. */
type WebEntry = Omit<Entry, "href"> & { webPath: string };

/** The workspace's settings, in the order of the web's settings hub, each
 *  behind the capability its routes check. A row with a `webPath` opens
 *  the web, because the screen does not fit a phone. */
const WORKSPACE: ((Entry | WebEntry) & {
	allowed: (access: Access) => boolean;
})[] = [
	{
		title: "Organization",
		icon: "organization",
		tint: "gray",
		href: "/workspace/organization",
		allowed: (access) => access.isAdmin,
	},
	{
		title: "Clients",
		icon: "client",
		tint: "indigo",
		href: "/workspace/clients",
		allowed: (access) => access.canManageClients,
	},
	{
		title: "People",
		icon: "people",
		tint: "blue",
		href: "/workspace/people",
		allowed: (access) => access.isAdmin,
	},
	{
		title: "Tasks",
		icon: "tasks",
		tint: "green",
		href: "/workspace/tasks",
		allowed: (access) => access.isAdmin,
	},
	{
		title: "Hour fund",
		icon: "fund",
		tint: "orange",
		href: "/workspace/hour-fund",
		allowed: (access) => access.isAdmin,
	},
	{
		title: "Reminders",
		icon: "reminder",
		tint: "red",
		href: "/workspace/reminders",
		allowed: (access) => access.isAdmin,
	},
	{
		title: "Integrations",
		icon: "integration",
		tint: "teal",
		href: "/workspace/integrations",
		allowed: (access) => access.isAdmin,
	},
	{
		title: "Webhooks",
		icon: "webhook",
		tint: "pink",
		href: "/workspace/webhooks",
		allowed: (access) => access.isAdmin,
	},
	{
		// The import reads Harvest CSV exports in a worker of the browser.
		// It does not fit a phone.
		title: "Import",
		icon: "importData",
		tint: "green",
		webPath: "import",
		allowed: (access) => access.isAdmin,
	},
	{
		title: "Holidays",
		icon: "holiday",
		tint: "orange",
		href: "/you/holidays",
		// Everyone reads the holidays of the workspace, as on the web. An
		// admin also turns one off.
		allowed: always,
	},
];

/**
 * The menu of every screen that is not a tab, the workspace switcher with
 * the invitations that wait and a new workspace, the account, the server
 * and sign-out. A section shows only what the person
 * may use: each row of "Workspace" needs its capability from `whoami`.
 */
export default function MoreScreen() {
	const router = useRouter();
	const me = useMe();
	// Unknown until `whoami` arrives: a seasonal row stays hidden until then.
	const today = useWhoami().data?.today ?? "";
	const access = useAccess();
	const assistant = useAssistantAvailable();
	const pendingCount = usePendingCount();
	const { origin, slug } = useWorkspace();
	const { setWorkspace, signOut } = useSession();
	const pageRows = PAGES.filter(
		(entry) => entry.allowed(access) && (entry.season?.(today) ?? true),
	);
	const workspaceRows = WORKSPACE.filter((entry) => entry.allowed(access));

	const confirmSignOut = () =>
		showDialog(
			"Sign out?",
			`The app forgets ${origin} and your sign-in on this phone.`,
			[
				{ text: "Cancel", style: "cancel" },
				{
					text: "Sign out",
					style: "destructive",
					onPress: () => void signOut(),
				},
			],
		);

	return (
		<Screen title="More" largeTitle>
			{assistant || pageRows.length > 0 ? (
				<SettingsSection>
					{assistant ? (
						<SettingsLink
							icon="assistant"
							tint="purple"
							title="Assistant"
							subtitle="Ask about your time, or let it log time for you"
							onPress={() => router.push("/assistant/new")}
						/>
					) : null}
					{pageRows.map((entry) => (
						<SettingsLink
							key={entry.title}
							icon={entry.icon}
							tint={entry.tint}
							title={entry.title}
							onPress={() => router.push(entry.href)}
						/>
					))}
				</SettingsSection>
			) : null}
			<SettingsSection title="Account">
				{me.data ? (
					<SettingsValue
						icon="person"
						tint="gray"
						title={me.data.user.name}
						subtitle={me.data.user.email}
						value=""
					/>
				) : null}
				{ACCOUNT.map((entry) => (
					<SettingsLink
						key={entry.title}
						icon={entry.icon}
						tint={entry.tint}
						title={entry.title}
						onPress={() => router.push(entry.href)}
					/>
				))}
			</SettingsSection>
			{workspaceRows.length > 0 ? (
				<SettingsSection title="Workspace">
					{workspaceRows.map((entry) =>
						"webPath" in entry ? (
							<SettingsLink
								key={entry.title}
								icon={entry.icon}
								tint={entry.tint}
								title={entry.title}
								external
								onPress={() =>
									void Linking.openURL(
										`${origin}/${slug}/settings/${entry.webPath}`,
									)
								}
							/>
						) : (
							<SettingsLink
								key={entry.title}
								icon={entry.icon}
								tint={entry.tint}
								title={entry.title}
								onPress={() => router.push(entry.href)}
							/>
						),
					)}
				</SettingsSection>
			) : null}
			{me.isPending ? (
				<Inset>
					<Skeleton height={56} />
					<Skeleton height={56} />
				</Inset>
			) : me.isError ? (
				<ErrorState error={me.error} onRetry={() => void me.refetch()} />
			) : (
				<>
					<SettingsSection title="Workspaces">
						{me.data.organizations.map((org) => (
							<SettingsChoice
								key={org.slug}
								icon="workspace"
								tint="blue"
								title={org.name}
								subtitle={org.slug}
								selected={org.slug === slug}
								onPress={() => void setWorkspace(org.slug)}
							/>
						))}
						{pendingCount > 0 ? (
							<SettingsLink
								icon="invitation"
								tint="orange"
								title="Invitations"
								subtitle="Workspaces that wait for your answer"
								value={String(pendingCount)}
								onPress={() => router.push("/onboarding")}
							/>
						) : null}
						{access.workspaceCreation ? (
							<SettingsLink
								icon="add"
								tint="green"
								title="New workspace"
								onPress={() => router.push("/new-workspace")}
							/>
						) : null}
					</SettingsSection>
				</>
			)}
			<SettingsSection title="Server">
				<SettingsValue
					icon="server"
					tint="gray"
					title="Address"
					subtitle={origin}
					value=""
				/>
				<SettingsLink
					icon="web"
					tint="blue"
					title="Open Farmer on the web"
					external
					onPress={() => void Linking.openURL(origin)}
				/>
			</SettingsSection>
			<SettingsSection title="App">
				<SettingsValue
					icon="info"
					tint="gray"
					title="Version"
					value={APP_VERSION}
				/>
				<SettingsLink
					icon="signOut"
					tint="red"
					title="Sign out"
					destructive
					onPress={confirmSignOut}
				/>
			</SettingsSection>
		</Screen>
	);
}
