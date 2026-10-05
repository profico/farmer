import type { AssistantSettings } from "@farmer/api-client";
import { Stack } from "expo-router";
import { useState } from "react";
import { Alert, View } from "react-native";

import {
	useAssistantModels,
	useConnectAssistant,
	useDisconnectAssistant,
	useUpdateAssistantSettings,
} from "../../src/api/assistant";
import { useAccess, useAssistantSettings } from "../../src/api/capabilities";
import { ModelPicker } from "../../src/assistant/model-picker";
import {
	ActionButton,
	EmptyState,
	ErrorBanner,
	ErrorState,
	Field,
	Skeleton,
	Text,
} from "../../src/ui/components";
import { Inset, Screen } from "../../src/ui/screen";
import {
	SettingsLink,
	SettingsSection,
	SettingsSwitch,
	SettingsValue,
} from "../../src/ui/settings-list";
import { usePalette } from "../../src/ui/theme";
import { SPACE } from "../../src/ui/type";

/** The longest house rules the server keeps. */
const MAX_SYSTEM_PROMPT = 4000;

const stateOf = (settings: AssistantSettings) =>
	settings.keyUnreadable
		? "Connect again"
		: !settings.configured
			? "Not connected"
			: settings.enabled
				? "On"
				: "Paused";

const connectedOn = (iso: string | null) =>
	iso
		? new Date(iso).toLocaleDateString(undefined, {
				day: "numeric",
				month: "short",
				year: "numeric",
			})
		: "-";

/** What a member sees: the state, the model and the house rules. */
function ReadOnly({ settings }: { settings: AssistantSettings }) {
	const palette = usePalette();
	return (
		<>
			<SettingsSection
				title="Assistant"
				footer="Only an admin can change these settings."
			>
				<SettingsValue
					icon="assistant"
					tint="purple"
					title="State"
					value={stateOf(settings)}
				/>
				<SettingsValue
					icon="settings"
					tint="gray"
					title="Model"
					value={settings.defaultModel ?? "-"}
				/>
			</SettingsSection>
			{settings.systemPrompt ? (
				<SettingsSection title="House rules">
					<View style={{ padding: SPACE.l }}>
						<Text variant="bodyMedium" color={palette.onSurfaceVariant}>
							{settings.systemPrompt}
						</Text>
					</View>
				</SettingsSection>
			) : null}
		</>
	);
}

/** An admin's form to connect the OpenRouter key and choose a model. */
function ConnectForm({
	settings,
	onPickModel,
	model,
}: {
	settings: AssistantSettings;
	onPickModel: () => void;
	model: string | null;
}) {
	const connect = useConnectAssistant();
	const [apiKey, setApiKey] = useState("");
	const ready = apiKey.trim() !== "" && model !== null;
	return (
		<>
			<SettingsSection
				title={settings.configured ? "Replace the key" : "Connect OpenRouter"}
				footer="The key goes to the server and never comes back to the app. Each answer costs credits on this account."
			>
				<SettingsValue
					icon="settings"
					tint="gray"
					title="Model"
					value={model ?? "Choose"}
					onPress={onPickModel}
				/>
			</SettingsSection>
			<Inset>
				<Field
					label="OpenRouter API key"
					hint="It starts with sk-or-. Make one at openrouter.ai, in Keys."
					value={apiKey}
					onChangeText={setApiKey}
					placeholder="sk-or-v1-..."
					secureTextEntry
					autoCapitalize="none"
					autoCorrect={false}
					editable={!connect.isPending}
				/>
				{connect.error ? <ErrorBanner message={connect.error.message} /> : null}
				<View style={{ flexDirection: "row" }}>
					<ActionButton
						label={settings.configured ? "Save the key" : "Connect"}
						disabled={!ready || connect.isPending}
						onPress={() => {
							if (!model) return;
							connect.mutate(
								{ apiKey: apiKey.trim(), defaultModel: model },
								{ onSuccess: () => setApiKey("") },
							);
						}}
					/>
				</View>
			</Inset>
		</>
	);
}

function HouseRules({ settings }: { settings: AssistantSettings }) {
	const palette = usePalette();
	const update = useUpdateAssistantSettings();
	const [rules, setRules] = useState(settings.systemPrompt ?? "");
	const changed = rules.trim() !== (settings.systemPrompt ?? "").trim();
	return (
		<>
			<Inset>
				<Text variant="titleSmall" color={palette.primary}>
					House rules
				</Text>
				<Text variant="bodySmall" color={palette.onSurfaceVariant}>
					Added to the assistant's instructions in every conversation of this
					workspace. The built-in rules come first.
				</Text>
				<Field
					label="House rules"
					value={rules}
					onChangeText={setRules}
					placeholder="Round every entry to the quarter hour."
					multiline
					maxLength={MAX_SYSTEM_PROMPT}
					hint={`${rules.length} of ${MAX_SYSTEM_PROMPT} characters`}
					editable={!update.isPending}
				/>
				{update.error ? <ErrorBanner message={update.error.message} /> : null}
				<View style={{ flexDirection: "row" }}>
					<ActionButton
						label="Save the house rules"
						variant="outlined"
						disabled={!changed || update.isPending}
						onPress={() =>
							update.mutate({
								systemPrompt: rules.trim() ? rules.trim() : null,
							})
						}
					/>
				</View>
			</Inset>
		</>
	);
}

/** An admin's view of a connected assistant. */
function Admin({ settings }: { settings: AssistantSettings }) {
	const update = useUpdateAssistantSettings();
	const disconnect = useDisconnectAssistant();
	const models = useAssistantModels(settings.available);
	const [picking, setPicking] = useState(false);
	const [replacing, setReplacing] = useState(false);
	// The model of the connect form, until the key is saved.
	const [draftModel, setDraftModel] = useState<string | null>(
		settings.defaultModel,
	);
	const needsKey = !settings.configured || settings.keyUnreadable;

	const confirmDisconnect = () =>
		Alert.alert(
			"Disconnect the assistant?",
			"The key is deleted from the server, and nobody in this workspace can use the assistant until an admin connects it again. The conversations stay.",
			[
				{ text: "Cancel", style: "cancel" },
				{
					text: "Disconnect",
					style: "destructive",
					onPress: () => disconnect.mutate(undefined),
				},
			],
		);

	const picker = (
		<ModelPicker
			visible={picking}
			models={models}
			selected={needsKey || replacing ? draftModel : settings.defaultModel}
			onClose={() => setPicking(false)}
			onPick={(id) => {
				setPicking(false);
				if (needsKey || replacing) setDraftModel(id);
				else update.mutate({ defaultModel: id });
			}}
		/>
	);

	if (!settings.available) {
		return (
			<>
				<EmptyState
					icon="assistant"
					title="The assistant is off on this server"
					message="The administrator of the server switched it off."
				/>
				{settings.configured || settings.keyUnreadable ? (
					<SettingsSection footer="Removes the stored key from the server.">
						<SettingsLink
							title="Disconnect"
							destructive
							onPress={confirmDisconnect}
						/>
					</SettingsSection>
				) : null}
			</>
		);
	}

	if (needsKey) {
		return (
			<>
				{settings.keyUnreadable ? (
					<Inset>
						<ErrorBanner message="The stored key can no longer be read. Paste it again. Every conversation stays." />
					</Inset>
				) : null}
				<ConnectForm
					settings={settings}
					model={draftModel}
					onPickModel={() => setPicking(true)}
				/>
				{picker}
			</>
		);
	}

	return (
		<>
			<SettingsSection title="Assistant">
				<SettingsSwitch
					icon="assistant"
					tint="purple"
					title="Assistant on"
					subtitle={settings.enabled ? undefined : "Paused for everybody here"}
					value={settings.enabled}
					disabled={update.isPending}
					onValueChange={(enabled) => update.mutate({ enabled })}
				/>
				<SettingsValue
					icon="settings"
					tint="gray"
					title="Model"
					value={settings.defaultModel ?? "Choose"}
					onPress={() => setPicking(true)}
				/>
				<SettingsValue
					icon="key"
					tint="orange"
					title="Key"
					value={settings.keyHint ?? "-"}
				/>
				<SettingsValue
					icon="calendar"
					tint="blue"
					title="Connected"
					value={connectedOn(settings.connectedAt)}
				/>
			</SettingsSection>
			{update.error ? (
				<Inset>
					<ErrorBanner message={update.error.message} />
				</Inset>
			) : null}
			<HouseRules key={settings.systemPrompt ?? ""} settings={settings} />
			{replacing ? (
				<ConnectForm
					settings={settings}
					model={draftModel}
					onPickModel={() => setPicking(true)}
				/>
			) : null}
			<SettingsSection>
				<SettingsLink
					icon="key"
					tint="orange"
					title={replacing ? "Keep the current key" : "Replace the key"}
					onPress={() => {
						setDraftModel(settings.defaultModel);
						setReplacing((open) => !open);
					}}
				/>
				<SettingsLink
					title="Disconnect"
					destructive
					onPress={confirmDisconnect}
				/>
			</SettingsSection>
			{disconnect.error ? (
				<Inset>
					<ErrorBanner message={disconnect.error.message} />
				</Inset>
			) : null}
			{picker}
		</>
	);
}

/**
 * The assistant's settings for the workspace. An admin connects the
 * OpenRouter key (write-only), chooses the model, pauses the assistant,
 * writes house rules and disconnects it. A member reads the same settings.
 */
export default function AssistantSettingsScreen() {
	const access = useAccess();
	const settings = useAssistantSettings();

	const body = (() => {
		if (access.ready && !access.fullApi) {
			return (
				<EmptyState
					icon="assistant"
					title="The assistant needs a newer server"
					message="Ask the administrator of the server to update Farmer."
				/>
			);
		}
		if (settings.error) {
			return (
				<ErrorState
					error={settings.error}
					onRetry={() => void settings.refetch()}
				/>
			);
		}
		if (!settings.data || !access.ready) {
			return (
				<Inset>
					<Skeleton height={56} />
					<Skeleton height={56} />
					<Skeleton height={120} />
				</Inset>
			);
		}
		return access.isAdmin ? (
			<Admin settings={settings.data} />
		) : (
			<ReadOnly settings={settings.data} />
		);
	})();

	return (
		<>
			<Stack.Screen options={{ title: "Assistant settings" }} />
			<Screen
				topInset={false}
				refreshing={settings.isRefetching}
				onRefresh={() => void settings.refetch()}
			>
				{body}
			</Screen>
		</>
	);
}
