import { useRouter } from "expo-router";
import { useState } from "react";

import { useServerFeatures } from "../src/api/capabilities";
import { useCreateWorkspace, useEnterWorkspace } from "../src/api/onboarding";
import { Sheet } from "../src/forms/sheet";
import { EmptyState, ErrorBanner, Field } from "../src/ui/components";
import { messageOf } from "../src/ui/errors";

const NAME_MAX_LENGTH = 120;

/** The timezone of the phone, as the web takes the timezone of the
 *  browser. UTC when the phone does not give one. */
const phoneTimezone = () => {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
	} catch {
		return "UTC";
	}
};

/**
 * A new workspace that the person owns, as "New organization" in the
 * web's workspace switcher. The web takes the timezone of the browser and
 * the country "US"; this form takes the timezone of the phone. An admin
 * changes both later in the Organization settings. After the create, the
 * new workspace opens.
 */
export default function NewWorkspaceScreen() {
	const router = useRouter();
	const { workspaceCreation } = useServerFeatures();
	const create = useCreateWorkspace();
	const enter = useEnterWorkspace();
	const [name, setName] = useState("");
	const [opening, setOpening] = useState(false);
	const trimmed = name.trim();

	const submit = () => {
		if (!trimmed) return;
		create.mutate(
			{ name: trimmed, timezone: phoneTimezone(), country: "US" },
			{
				onSuccess: async (workspace) => {
					setOpening(true);
					try {
						await enter(workspace.slug);
					} finally {
						setOpening(false);
					}
					router.dismissTo("/");
				},
			},
		);
	};

	if (!workspaceCreation) {
		return (
			<Sheet
				title="New workspace"
				actionLabel="Create"
				onAction={() => undefined}
				actionDisabled
			>
				<EmptyState
					icon="workspace"
					title="New workspace"
					message="This server does not let a person make a workspace."
				/>
			</Sheet>
		);
	}

	return (
		<Sheet
			title="New workspace"
			actionLabel="Create"
			onAction={submit}
			busy={create.isPending || opening}
			actionDisabled={!trimmed || trimmed.length > NAME_MAX_LENGTH}
		>
			<Field
				label="Name"
				value={name}
				onChangeText={setName}
				placeholder="Acme Inc."
				maxLength={NAME_MAX_LENGTH}
				autoCapitalize="words"
				returnKeyType="done"
				onSubmitEditing={submit}
				hint="You own the new workspace. Its timezone is the one of this phone. Change it later in the Organization settings."
			/>
			{create.error ? (
				<ErrorBanner message={messageOf(create.error) ?? ""} />
			) : null}
		</Sheet>
	);
}
