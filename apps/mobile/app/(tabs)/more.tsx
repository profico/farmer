import { type Href, useRouter } from "expo-router";
import { Alert, Linking } from "react-native";

import {
	type Access,
	useAccess,
	useAssistantAvailable,
} from "../../src/api/capabilities";
import { useMe, useWorkspace } from "../../src/api/queries";
import { APP_VERSION } from "../../src/config";
import { useSession } from "../../src/session/session";
import { ErrorState, Skeleton } from "../../src/ui/components";
import type { IconName } from "../../src/ui/icons";
import { Inset, Screen } from "../../src/ui/screen";
import {
	type RowTint,
	SettingsChoice,
	SettingsLink,
	SettingsSection,
	SettingsValue,
} from "../../src/ui/settings-list";

type Entry = {
	title: string;
	icon: IconName;
	tint: RowTint;
	href: Href;
};

/** The person's own settings and records. They need API version 2, except
 *  a `local` one, which stays on the phone. */
const YOU: (Entry & { local?: true })[] = [
	{
		title: "Preferences",
		icon: "preferences",
		tint: "gray",
		href: "/you/preferences",
	},
	{ title: "Schedule", icon: "schedule", tint: "blue", href: "/you/schedule" },
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
	{ title: "Holidays", icon: "holiday", tint: "orange", href: "/you/holidays" },
	{ title: "Absences", icon: "absence", tint: "red", href: "/you/absences" },
	{ title: "Rewind", icon: "rewind", tint: "purple", href: "/you/rewind" },
	{
		title: "Display",
		icon: "display",
		tint: "indigo",
		href: "/you/display",
		local: true,
	},
];

/** The workspace's settings, each behind the capability its routes check. */
const WORKSPACE: (Entry & { allowed: (access: Access) => boolean })[] = [
	{
		title: "People",
		icon: "people",
		tint: "blue",
		href: "/workspace/people",
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
		title: "Organization",
		icon: "organization",
		tint: "gray",
		href: "/workspace/organization",
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
		title: "Workspace integrations",
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
		title: "Audit log",
		icon: "audit",
		tint: "gray",
		href: "/workspace/audit-log",
		allowed: (access) => access.isAdmin,
	},
	{
		title: "Assistant settings",
		icon: "assistant",
		tint: "purple",
		href: "/workspace/assistant",
		allowed: (access) => access.isAdmin,
	},
];

/**
 * The menu of every screen that is not a tab, the workspace switcher, the
 * account, the server and sign-out. A section shows only what the person
 * may use: "You" needs a Server with API version 2, and each row of
 * "Workspace" needs its capability from `whoami`.
 */
export default function MoreScreen() {
	const router = useRouter();
	const me = useMe();
	const access = useAccess();
	const assistant = useAssistantAvailable();
	const { origin, slug } = useWorkspace();
	const { setWorkspace, signOut } = useSession();
	const youRows = YOU.filter((entry) => access.fullApi || entry.local);
	const workspaceRows = WORKSPACE.filter((entry) => entry.allowed(access));

	const confirmSignOut = () =>
		Alert.alert(
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
		<Screen title="More">
			{assistant ? (
				<SettingsSection>
					<SettingsLink
						icon="assistant"
						tint="purple"
						title="Assistant"
						subtitle="Ask about your time, or let it log time for you"
						onPress={() => router.push("/assistant")}
					/>
				</SettingsSection>
			) : null}
			{youRows.length > 0 ? (
				<SettingsSection title="You">
					{youRows.map((entry) => (
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
			{workspaceRows.length > 0 ? (
				<SettingsSection title="Workspace">
					{workspaceRows.map((entry) => (
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
					</SettingsSection>
					<SettingsSection title="Account">
						<SettingsValue
							icon="person"
							tint="gray"
							title={me.data.user.name}
							subtitle={me.data.user.email}
							value=""
						/>
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
