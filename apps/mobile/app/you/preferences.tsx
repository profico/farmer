import { useRouter } from "expo-router";
import { Linking } from "react-native";

import { useTasks, useWorkspace } from "../../src/api/queries";
import {
	useFilingRules,
	useHiddenTasks,
	useNotificationSettings,
	usePushRelayEnabled,
	useUpdateNotificationSettings,
} from "../../src/api/you";
import { requestNotificationPermission } from "../../src/push/registration";
import { ErrorBanner, ErrorState } from "../../src/ui/components";
import { messageOf } from "../../src/ui/errors";
import { Inset } from "../../src/ui/screen";
import {
	SettingsChoice,
	SettingsLink,
	SettingsSection,
	SettingsSwitch,
} from "../../src/ui/settings-list";
import { ListSkeleton, YouScreen } from "../../src/you/components/you-screen";
import { selectableTasks } from "../../src/you/tasks";

/**
 * The person's own preferences in this workspace: the tasks they use, the
 * reminders and the filing rules. The sign-in methods change in the
 * browser, so their row opens the web page.
 */
export default function PreferencesScreen() {
	const router = useRouter();
	const { origin, slug } = useWorkspace();
	const tasks = useTasks();
	const hidden = useHiddenTasks();
	const notifications = useNotificationSettings();
	const update = useUpdateNotificationSettings();
	const rules = useFilingRules();
	const pushRelay = usePushRelayEnabled();

	const all = tasks.data ? selectableTasks(tasks.data) : [];
	const hiddenIds = new Set(hidden.data?.taskIds);
	const offCount = all.filter((task) => hiddenIds.has(task.id)).length;
	const ruleCount = rules.data?.length ?? 0;

	// A reminder to the app needs the permission of the phone. Ask when the
	// person makes that choice, not at launch. The save does not wait for
	// the answer.
	const askForApp = () => {
		if (pushRelay) void requestNotificationPermission();
	};

	const refresh = () => {
		void tasks.refetch();
		void hidden.refetch();
		void notifications.refetch();
		void rules.refetch();
	};

	return (
		<YouScreen
			title="Preferences"
			refreshing={notifications.isRefetching}
			onRefresh={refresh}
		>
			<SettingsSection footer="Tasks you switch off leave the task list, search included, wherever you log time.">
				<SettingsLink
					icon="tasks"
					tint="green"
					title="Your tasks"
					value={
						tasks.data && hidden.data
							? `${all.length - offCount} of ${all.length} on`
							: ""
					}
					onPress={() => router.push("/you/tasks")}
				/>
			</SettingsSection>

			{update.error ? (
				<Inset>
					<ErrorBanner message={messageOf(update.error) ?? ""} />
				</Inset>
			) : null}
			{notifications.isPending ? (
				<ListSkeleton rows={2} />
			) : notifications.isError ? (
				<ErrorState
					error={notifications.error}
					onRetry={() => void notifications.refetch()}
				/>
			) : (
				<>
					<SettingsSection title="Notifications">
						<SettingsSwitch
							icon="reminder"
							tint="red"
							title="Log reminders"
							subtitle="A nudge when you have days with no time logged."
							value={notifications.data.logReminders}
							onValueChange={(logReminders) => {
								update.mutate({ logReminders });
								if (
									logReminders &&
									notifications.data.remindersChannel === "app"
								) {
									askForApp();
								}
							}}
						/>
					</SettingsSection>
					{pushRelay ? (
						<SettingsSection
							title="Send reminders to"
							footer="The month-end reminders and the nudges go to the app only when this phone allows notifications from Farmer. If it does not, they go to Slack."
						>
							<SettingsChoice
								title="The app"
								selected={notifications.data.remindersChannel === "app"}
								onPress={() => {
									update.mutate({ remindersChannel: "app" });
									askForApp();
								}}
							/>
							<SettingsChoice
								title="Slack"
								selected={notifications.data.remindersChannel === "slack"}
								onPress={() => update.mutate({ remindersChannel: "slack" })}
							/>
						</SettingsSection>
					) : null}
				</>
			)}

			{ruleCount > 0 ? (
				<SettingsSection
					title="Automatic filing"
					footer="Entries with these names are filed against their project and task, instead of waiting for you in File your time."
				>
					<SettingsLink
						icon="inbox"
						tint="blue"
						title="Filing rules"
						value={String(ruleCount)}
						onPress={() => router.push("/you/filing-rules")}
					/>
				</SettingsSection>
			) : null}

			<SettingsSection
				title="Sign-in"
				footer="You connect or disconnect Google sign-in in Farmer on the web. The change applies to your account in every workspace."
			>
				<SettingsLink
					icon="key"
					tint="gray"
					title="Google sign-in"
					external
					onPress={() =>
						void Linking.openURL(`${origin}/${slug}/settings/preferences`)
					}
				/>
			</SettingsSection>
		</YouScreen>
	);
}
