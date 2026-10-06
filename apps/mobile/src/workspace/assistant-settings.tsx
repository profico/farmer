import type { AssistantSettings } from "@farmer/api-client";
import { useState } from "react";
import { View } from "react-native";

import {
	useAssistantModels,
	useConnectAssistant,
	useDisconnectAssistant,
	useUpdateAssistantSettings,
} from "../api/assistant";
import { ModelPicker } from "../assistant/model-picker";
import {
	ActionButton,
	EmptyState,
	ErrorBanner,
	Field,
	Text,
} from "../ui/components";
import { showDialog } from "../ui/dialog";
import { Inset } from "../ui/screen";
import {
	SettingsLink,
	SettingsSection,
	SettingsSwitch,
	SettingsValue,
} from "../ui/settings-list";
import { usePalette } from "../ui/theme";

/** The longest house rules the server keeps. */
const MAX_SYSTEM_PROMPT = 4000;

const connectedOn = (iso: string | null) =>
	iso
		? new Date(iso).toLocaleDateString(undefined, {
				day: "numeric",
				month: "short",
				year: "numeric",
			})
		: "-";

/** The model of a first connection, as the web's connect form sends it
 *  (`settings/workspace-integrations.tsx`). The admin changes it after the
 *  connection, because the server lists the models only with a key. */
const FIRST_MODEL = "openai/gpt-4o-mini";

/**
 * An admin's form to connect the OpenRouter key. The model can be chosen
 * here only when a working key is replaced: before the first key, the
 * server cannot list the models, so the form connects with the stored model
 * or `FIRST_MODEL`, as the web does.
 */
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
	const ready = apiKey.trim() !== "";
	const canPickModel = settings.configured && !settings.keyUnreadable;
	return (
		<>
			<SettingsSection
				title={settings.configured ? "Replace the key" : "Connect OpenRouter"}
				footer="The key goes to the server and never comes back to the app. Each answer costs credits on this account."
			>
				{canPickModel ? (
					<SettingsValue
						icon="settings"
						tint="gray"
						title="Model"
						value={model ?? "Choose"}
						onPress={onPickModel}
					/>
				) : null}
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
							connect.mutate(
								{
									apiKey: apiKey.trim(),
									defaultModel: model ?? settings.defaultModel ?? FIRST_MODEL,
								},
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

/**
 * The assistant's settings for the workspace, as the web shows them in the
 * workspace integrations. An admin connects the OpenRouter key
 * (write-only), chooses the model, pauses the assistant, writes house rules
 * and disconnects it. A member does not see them, as on the web.
 */
export function AssistantSettingsSections({
	settings,
}: {
	settings: AssistantSettings;
}) {
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
		showDialog(
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
