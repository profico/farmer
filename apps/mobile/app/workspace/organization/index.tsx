import type { OrgPolicy } from "@farmer/api-client";
import { Stack, useRouter } from "expo-router";
import { type ReactNode, useState } from "react";
import { Image, Platform, View } from "react-native";

import { useAccess } from "../../../src/api/capabilities";
import { useUploadImage } from "../../../src/api/uploads";
import {
	useOrganization,
	useOrgPolicy,
	useUpdateOrganization,
	useUpdateOrgPolicy,
} from "../../../src/api/workspace";
import { SettingTitle } from "../../../src/forms/setting-title";
import { useSignedIn } from "../../../src/session/session";
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
import { isSvgUpload } from "../../../src/uploads/limits";
import {
	ActionRow,
	ChoiceSection,
	ListSkeleton,
	notify,
	notifyError,
	PickerRow,
} from "../../../src/workspace/components";
import { SaveBar, useSaveBar } from "../../../src/workspace/save-bar";

const NAME_MAX_LENGTH = 120;
const LOGO_MAX_LENGTH = 2048;

const WEEK_START_OPTIONS = [
	{ value: 1, label: "Monday" },
	{ value: 0, label: "Sunday" },
] as const;

/** A logo is a public address. The server refuses any other scheme. */
const isHttpUrl = (value: string) => /^https?:\/\/\S+$/i.test(value);

/** The general settings of the workspace: name, country, timezone, the
 *  first day of the week, the logo, the tracking
 *  tolerance and the automation lock. Admins only, as on the web. */
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
					<IosSaveBar>
						<OrganizationForm settings={settings.data} />
						<PolicySections />
					</IosSaveBar>
				)}
			</Screen>
		</>
	);
}

/** iOS saves the settings with one button in the navigation bar. Android
 *  has a button under each setting. */
function IosSaveBar({ children }: { children: ReactNode }) {
	if (Platform.OS !== "ios") return <>{children}</>;
	return <SaveBar>{children}</SaveBar>;
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
	const { origin } = useSignedIn();
	const { uploads } = useAccess();
	const update = useUpdateOrganization();
	const upload = useUploadImage("org-logo");
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

	// Saved as soon as it is on the Server, as on the web: the choice of
	// the image was the decision.
	const uploadLogo = () =>
		upload.mutate(undefined, {
			onSuccess: (path) => {
				if (!path) return;
				setLogo(path);
				save({ logo: path }, "Logo saved", "Could not save the logo");
			},
			onError: (error) => notifyError("Could not upload the logo", error),
		});

	const saveName = () =>
		save(
			{ name: trimmedName },
			"Organization name saved",
			"Could not save the name",
		);
	const saveLogo = () =>
		save({ logo: trimmedLogo }, "Logo saved", "Could not save the logo");
	useSaveBar("name", nameChanged, saveName);
	useSaveBar("logo", !uploadedLogo && logoChanged && logoValid, saveLogo);

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
				{Platform.OS === "ios" ? null : (
					<View style={{ alignItems: "flex-end" }}>
						<ActionButton
							label="Save name"
							disabled={!nameChanged || update.isPending}
							onPress={saveName}
						/>
					</View>
				)}
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
				{/* The heading names the setting and the field names what goes in
				    it, so the two never show the same words. */}
				<SettingTitle>Logo</SettingTitle>
				{uploadedLogo && settings.logo ? (
					<View
						style={{
							flexDirection: "row",
							alignItems: "center",
							gap: SPACE.m,
						}}
					>
						{isSvgUpload(settings.logo) ? null : (
							<Image
								accessibilityIgnoresInvertColors
								source={{ uri: `${origin}${settings.logo}` }}
								style={{
									width: 44,
									height: 44,
									borderRadius: 8,
									backgroundColor: palette.surfaceContainerHigh,
								}}
								resizeMode="contain"
							/>
						)}
						<View style={{ flex: 1 }}>
							<Text variant="bodyMedium" color={palette.onSurfaceVariant}>
								An uploaded image. Remove it to use an address instead.
							</Text>
						</View>
					</View>
				) : (
					<Field
						label="Image address"
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
						hint={
							uploads
								? "The logo of the organization. Upload an image, or enter a public image address (SVG or PNG work best). Leave it empty to use the organization initials."
								: "A public image address (SVG or PNG work best). Leave it empty to use the organization initials."
						}
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
					{uploads ? (
						<ActionButton
							label={upload.isPending ? "Uploading" : "Upload image"}
							variant="outlined"
							disabled={upload.isPending || update.isPending}
							onPress={uploadLogo}
						/>
					) : null}
					{uploadedLogo || Platform.OS === "ios" ? null : (
						<ActionButton
							label="Save logo"
							disabled={!logoChanged || !logoValid || update.isPending}
							onPress={saveLogo}
						/>
					)}
				</View>
			</Inset>
		</>
	);
}

/** The tolerance the web allows, in percent. */
const TOLERANCE_MAX = 50;

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** The tracking tolerance and the automation lock, once they are read. */
function PolicySections() {
	const policy = useOrgPolicy();
	if (policy.isPending) return <ListSkeleton rows={2} />;
	if (policy.isError) {
		return (
			<ErrorState error={policy.error} onRetry={() => void policy.refetch()} />
		);
	}
	return <PolicyForm policy={policy.data} />;
}

/**
 * The two knobs of the organization policy, each with its own Save, as on
 * the web. The tolerance is the only knob of the Tracking rule. The lock
 * stops the automations on and before a day, so a closed month gets no
 * more hours. It does not stop people: they can still edit their entries.
 */
function PolicyForm({ policy }: { policy: OrgPolicy }) {
	const update = useUpdateOrgPolicy();
	const [pct, setPct] = useState(String(policy.trackingTolerancePct));
	const [lock, setLock] = useState<string | null>(
		policy.automationLockedThrough,
	);

	const parsed = Number(pct);
	const pctValid =
		pct.trim() !== "" &&
		Number.isInteger(parsed) &&
		parsed >= 0 &&
		parsed <= TOLERANCE_MAX;
	const pctChanged = pctValid && parsed !== policy.trackingTolerancePct;

	const lockValid = lock === null || DAY_KEY.test(lock);
	const lockChanged =
		lockValid && lock !== (policy.automationLockedThrough ?? null);

	const saveTolerance = () =>
		update.mutate(
			{ trackingTolerancePct: parsed },
			{
				onSuccess: () => notify("Tracking tolerance saved"),
				onError: (error) => {
					setPct(String(policy.trackingTolerancePct));
					notifyError("Could not save the tolerance", error);
				},
			},
		);

	const saveLock = () =>
		update.mutate(
			{ automationLockedThrough: lock },
			{
				onSuccess: () =>
					notify(
						lock
							? `Automation locked through ${lock}`
							: "Automation lock removed",
					),
				onError: (error) => {
					setLock(policy.automationLockedThrough);
					notifyError("Could not save the lock", error);
				},
			},
		);

	useSaveBar("tolerance", pctChanged, saveTolerance);
	useSaveBar("lock", lockChanged, saveLock);

	return (
		<>
			<Inset>
				<SettingTitle>Tracking tolerance</SettingTitle>
				<Field
					label="Tolerance, percent"
					value={pct}
					onChangeText={setPct}
					keyboardType="number-pad"
					maxLength={2}
					returnKeyType="done"
					error={
						pct.trim() === "" || pctValid
							? null
							: `Enter a whole number from 0 to ${TOLERANCE_MAX}.`
					}
					hint="How far below the target so far a person can be and still count as only slightly behind. Past it, the person is behind, on the Tracking report and in every reminder. The target is the hour fund of the month, spread over its working days (8 h each, without public holidays). The total of a person is work plus time off."
				/>
				{Platform.OS === "ios" ? null : (
					<View style={{ alignItems: "flex-end" }}>
						<ActionButton
							label="Save tolerance"
							disabled={!pctChanged || update.isPending}
							onPress={saveTolerance}
						/>
					</View>
				)}
			</Inset>

			<SettingsSection
				title="Automation lock"
				footer="The last day that the sync engines may not change. Recurring blocks, calendar meetings and commit blocks stop at this day, so a month that you closed cannot get more hours. People can still edit their own entries in those months: the lock stops only the automations."
			>
				<PickerRow
					title="Locked through"
					mode="date"
					value={lock}
					placeholder="No lock"
					disabled={update.isPending}
					onChange={setLock}
				/>
				{lock !== null ? (
					<ActionRow
						label="Remove the lock"
						icon="lock"
						destructive
						disabled={update.isPending}
						onPress={() => setLock(null)}
					/>
				) : null}
			</SettingsSection>
			{Platform.OS === "ios" ? null : (
				<Inset>
					<View style={{ alignItems: "flex-end" }}>
						<ActionButton
							label="Save lock"
							disabled={!lockChanged || update.isPending}
							onPress={saveLock}
						/>
					</View>
				</Inset>
			)}
		</>
	);
}
