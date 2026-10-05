import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { useAccess } from "../../../src/api/capabilities";
import {
	useOrganization,
	useUpdateOrganization,
} from "../../../src/api/workspace";
import {
	ActionButton,
	EmptyState,
	ErrorBanner,
	ErrorState,
	Field,
	Text,
} from "../../../src/ui/components";
import { messageOf } from "../../../src/ui/errors";
import { Inset, Screen } from "../../../src/ui/screen";
import {
	SettingsLink,
	SettingsSection,
	SettingsValue,
} from "../../../src/ui/settings-list";
import { usePalette } from "../../../src/ui/theme";
import { SPACE } from "../../../src/ui/type";
import {
	ChoiceSection,
	ListSkeleton,
	notify,
	notifyError,
} from "../../../src/workspace/components";

const NAME_MAX_LENGTH = 120;
const LOGO_MAX_LENGTH = 2048;

const WEEK_START_OPTIONS = [
	{ value: 1, label: "Monday" },
	{ value: 0, label: "Sunday" },
] as const;

/** A logo is a public address. The server refuses any other scheme. */
const isHttpUrl = (value: string) => /^https?:\/\/\S+$/i.test(value);

/** The general settings of the workspace: name, country, timezone, the
 *  first day of the week and the logo address. Admins only, as on the web. */
export default function OrganizationScreen() {
	const access = useAccess();
	if (access.ready && !access.isAdmin) {
		return (
			<>
				<Stack.Screen options={{ title: "Organization" }} />
				<Screen topInset={false}>
					<EmptyState
						icon="organization"
						title="Admins only"
						message="Only an admin can change the organization."
					/>
				</Screen>
			</>
		);
	}
	return <OrganizationSettings />;
}

function OrganizationSettings() {
	const settings = useOrganization();
	return (
		<>
			<Stack.Screen options={{ title: "Organization" }} />
			<Screen
				topInset={false}
				refreshing={settings.isRefetching}
				onRefresh={() => void settings.refetch()}
			>
				{settings.isPending ? (
					<ListSkeleton />
				) : settings.isError ? (
					<ErrorState
						error={settings.error}
						onRetry={() => void settings.refetch()}
					/>
				) : (
					<OrganizationForm settings={settings.data} />
				)}
			</Screen>
		</>
	);
}

function OrganizationForm({
	settings,
}: {
	settings: {
		name: string;
		country: string;
		timezone: string;
		weekStartsOn: number;
		logo: string | null;
	};
}) {
	const router = useRouter();
	const palette = usePalette();
	const update = useUpdateOrganization();
	const [name, setName] = useState(settings.name);
	const [logo, setLogo] = useState(settings.logo ?? "");

	const trimmedName = name.trim();
	const nameChanged =
		trimmedName.length > 0 &&
		trimmedName.length <= NAME_MAX_LENGTH &&
		trimmedName !== settings.name;

	const trimmedLogo = logo.trim();
	// An uploaded logo is a path on the server, not an address. The app does
	// not edit it, and Remove clears it.
	const uploadedLogo = settings.logo !== null && !isHttpUrl(settings.logo);
	const logoValid = trimmedLogo === "" || isHttpUrl(trimmedLogo);
	const logoChanged = trimmedLogo !== (settings.logo ?? "");

	const save = (
		body: Parameters<typeof update.mutate>[0],
		saved: string,
		failed: string,
	) =>
		update.mutate(body, {
			onSuccess: () => notify(saved),
			onError: (error) => notifyError(failed, error),
		});

	const weekStart = settings.weekStartsOn === 0 ? 0 : 1;
	const failure = messageOf(update.error);

	return (
		<>
			{failure ? (
				<Inset>
					<ErrorBanner message={failure} />
				</Inset>
			) : null}
			<Inset>
				<Field
					label="Name"
					value={name}
					onChangeText={setName}
					maxLength={NAME_MAX_LENGTH}
					placeholder="Acme Inc."
					returnKeyType="done"
					hint="The display name of the organization, shown in the switcher."
				/>
				<View style={{ alignItems: "flex-end" }}>
					<ActionButton
						label="Save name"
						disabled={!nameChanged || update.isPending}
						onPress={() =>
							save(
								{ name: trimmedName },
								"Organization name saved",
								"Could not save the name",
							)
						}
					/>
				</View>
			</Inset>

			<SettingsSection
				title="Country"
				footer="Decides the public holidays of the organization. Change it on the web."
			>
				<SettingsValue
					icon="holiday"
					title="Country"
					value={settings.country.toUpperCase()}
				/>
			</SettingsSection>

			<SettingsSection
				title="Timezone"
				footer="Decides which day an entry or a synced meeting falls on, the meeting times shown, and when today starts."
			>
				<SettingsLink
					icon="schedule"
					title="Timezone"
					value={settings.timezone.replaceAll("_", " ")}
					onPress={() => router.push("/workspace/organization/timezone")}
				/>
			</SettingsSection>

			<ChoiceSection
				title="Week starts on"
				footer="The first day of every week in this organization: the timesheet, the home page, week reports, date pickers and the CLI."
				options={WEEK_START_OPTIONS}
				value={weekStart}
				disabled={update.isPending}
				onChange={(next) =>
					save(
						{ weekStartsOn: next },
						"Week start saved",
						"Could not save the week start",
					)
				}
			/>

			<Inset>
				<Text variant="titleSmall" color={palette.primary}>
					Logo URL
				</Text>
				{uploadedLogo ? (
					<Text variant="bodyMedium" color={palette.onSurfaceVariant}>
						An uploaded image. Remove it to use an address instead.
					</Text>
				) : (
					<Field
						label="Logo URL"
						value={logo}
						onChangeText={setLogo}
						placeholder="https://example.com/logo.svg"
						keyboardType="url"
						autoCapitalize="none"
						autoCorrect={false}
						maxLength={LOGO_MAX_LENGTH}
						returnKeyType="done"
						error={
							logoValid
								? null
								: "Enter an address that starts with http:// or https://."
						}
						hint="A public image address (SVG or PNG work best). Leave it empty to use the organization initials."
					/>
				)}
				<View
					style={{
						flexDirection: "row",
						justifyContent: "flex-end",
						gap: SPACE.s,
					}}
				>
					{settings.logo ? (
						<ActionButton
							label="Remove"
							variant="text"
							disabled={update.isPending}
							onPress={() => {
								setLogo("");
								save({ logo: "" }, "Logo removed", "Could not remove the logo");
							}}
						/>
					) : null}
					{uploadedLogo ? null : (
						<ActionButton
							label="Save logo"
							disabled={!logoChanged || !logoValid || update.isPending}
							onPress={() =>
								save(
									{ logo: trimmedLogo },
									"Logo saved",
									"Could not save the logo",
								)
							}
						/>
					)}
				</View>
			</Inset>
		</>
	);
}
