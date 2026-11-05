import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { useCreateApiToken } from "../../src/api/account";
import { useMe, useWorkspace } from "../../src/api/queries";
import {
	FormCluster,
	FormPart,
	FormSection,
	Sheet,
} from "../../src/forms/sheet";
import { ErrorBanner, Field } from "../../src/ui/components";
import { messageOf } from "../../src/ui/errors";
import { SettingsChoice, SettingsSection } from "../../src/ui/settings-list";
import { SPACE } from "../../src/ui/type";
import { SecretCard } from "../../src/workspace/webhooks/secret-card";
import {
	newTokenDraft,
	TOKEN_LIFETIMES,
	TOKEN_NAME_MAX,
	TOKEN_SCOPES,
	TOKEN_WORKSPACES,
	tokenNameProblem,
} from "../../src/you/account";

/**
 * Makes an API token, then shows it one time. The token stays in this
 * component's state. The mutation result is reset at once, so the token does
 * not stay in the mutation cache.
 */
export default function NewApiTokenSheet() {
	const router = useRouter();
	const create = useCreateApiToken();
	const { slug } = useWorkspace();
	const me = useMe();
	const workspaceName =
		me.data?.organizations.find((org) => org.slug === slug)?.name ?? slug;
	const [draft, setDraft] = useState(newTokenDraft);
	const [token, setToken] = useState<string | null>(null);
	const [touched, setTouched] = useState(false);

	if (token !== null) {
		return (
			<Sheet
				title="API token"
				actionLabel="Done"
				onAction={() => router.back()}
			>
				<View style={{ marginHorizontal: -SPACE.l }}>
					<SecretCard
						secret={token}
						subject="token"
						message="Shown once. Keep it where you keep a password. If you lose it, revoke it and make a new one. Send it as a bearer token in the Authorization header."
					/>
				</View>
			</Sheet>
		);
	}

	const problem = tokenNameProblem(draft.name);
	const failure = messageOf(create.error);
	const save = () => {
		setTouched(true);
		if (problem !== null) return;
		create.mutate(
			{ ...draft, name: draft.name.trim() },
			{
				onSuccess: (result) => {
					setToken(result.token);
					create.reset();
				},
			},
		);
	};

	return (
		<Sheet
			title="New API token"
			actionLabel="Make token"
			onAction={save}
			busy={create.isPending}
		>
			{failure ? <ErrorBanner message={failure} /> : null}
			<FormCluster>
				<FormPart
					footerError={touched && problem !== null}
					groupFooter={touched ? (problem ?? undefined) : undefined}
				>
					<Field
						label="Name"
						value={draft.name}
						onChangeText={(name) => setDraft({ ...draft, name })}
						placeholder="Monthly export"
						maxLength={TOKEN_NAME_MAX + 20}
						error={touched ? problem : null}
					/>
				</FormPart>
			</FormCluster>
			<FormSection label="Access">
				<View style={{ marginHorizontal: -SPACE.l }}>
					<SettingsSection footer="A read-only token cannot add, change or delete anything.">
						{TOKEN_SCOPES.map((option) => (
							<SettingsChoice
								key={option.value}
								title={option.label}
								selected={draft.scope === option.value}
								onPress={() => setDraft({ ...draft, scope: option.value })}
							/>
						))}
					</SettingsSection>
				</View>
			</FormSection>
			<FormSection label="Workspaces">
				<View style={{ marginHorizontal: -SPACE.l }}>
					<SettingsSection>
						{TOKEN_WORKSPACES.map((option) => (
							<SettingsChoice
								key={option.value}
								title={option.label}
								subtitle={option.value === "this" ? workspaceName : undefined}
								selected={draft.workspace === option.value}
								onPress={() => setDraft({ ...draft, workspace: option.value })}
							/>
						))}
					</SettingsSection>
				</View>
			</FormSection>
			<FormSection label="Expires after">
				<View style={{ marginHorizontal: -SPACE.l }}>
					<SettingsSection>
						{TOKEN_LIFETIMES.map((option) => (
							<SettingsChoice
								key={option.label}
								title={option.label}
								selected={draft.expiresInDays === option.value}
								onPress={() =>
									setDraft({ ...draft, expiresInDays: option.value })
								}
							/>
						))}
					</SettingsSection>
				</View>
			</FormSection>
		</Sheet>
	);
}
