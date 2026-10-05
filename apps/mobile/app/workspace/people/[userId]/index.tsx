import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { useWhoami } from "../../../../src/api/queries";
import {
	useArchivePerson,
	useConfirmPersonEmail,
	usePeople,
	usePerson,
	useRemovePerson,
	useSetPersonRole,
	useSetPersonStartDate,
	useSetPersonType,
} from "../../../../src/api/workspace";
import { ErrorState, Field } from "../../../../src/ui/components";
import { Screen } from "../../../../src/ui/screen";
import {
	SettingsLink,
	SettingsSection,
	SettingsValue,
} from "../../../../src/ui/settings-list";
import { SPACE } from "../../../../src/ui/type";
import {
	ActionRow,
	ChoiceSection,
	confirmAction,
	confirmDestructive,
	DetailRow,
	ListSkeleton,
	notify,
	notifyError,
	PickerRow,
} from "../../../../src/workspace/components";
import {
	formatDay,
	hoursOf,
	peopleCount,
} from "../../../../src/workspace/format";
import { paramOf } from "../../../../src/workspace/params";
import {
	isHourlyType,
	MEMBER_TYPE_OPTIONS,
	memberTypeOf,
	ROLE_OPTIONS,
	typeLabelOf,
} from "../../../../src/workspace/people/labels";

/** One person: role, type, start date, the people they lead and the
 *  actions that archive, confirm or remove them. */
export default function PersonScreen() {
	const router = useRouter();
	const userId =
		paramOf(useLocalSearchParams<{ userId: string }>().userId) ?? "";
	const whoami = useWhoami();
	const profile = usePerson(userId);
	const people = usePeople();

	const setRole = useSetPersonRole();
	const setType = useSetPersonType();
	const setStartDate = useSetPersonStartDate();
	const archive = useArchivePerson();
	const confirmEmail = useConfirmPersonEmail();
	const remove = useRemovePerson();

	// The text of the hours field while it is edited. Null shows the saved value.
	const [hoursDraft, setHoursDraft] = useState<string | null>(null);

	const refresh = () => {
		void profile.refetch();
		void people.refetch();
	};

	if (profile.isPending) {
		return (
			<Screen topInset={false}>
				<Stack.Screen options={{ title: "Person" }} />
				<ListSkeleton />
			</Screen>
		);
	}
	if (profile.error) {
		return (
			<Screen topInset={false}>
				<Stack.Screen options={{ title: "Person" }} />
				<ErrorState error={profile.error} onRetry={refresh} />
			</Screen>
		);
	}

	const { person, typeHistory } = profile.data;
	const today = whoami.data?.today;
	const isSelf = whoami.data?.userId === person.userId;
	const archived = person.archivedAt !== null;
	const owners = (people.data ?? []).filter(
		(row) => row.orgRole === "owner" && row.archivedAt === null,
	).length;
	const isOnlyOwner = person.orgRole === "owner" && owners <= 1;
	const canManage = !isSelf && !isOnlyOwner;
	const hourly = isHourlyType(person.type);
	const savedHours =
		person.expectedSecondsOverride === null
			? ""
			: hoursOf(person.expectedSecondsOverride);
	const busy =
		setRole.isPending ||
		setType.isPending ||
		setStartDate.isPending ||
		archive.isPending ||
		confirmEmail.isPending ||
		remove.isPending;

	const changeType = (type: string, expectedSecondsOverride: number | null) => {
		const picked = memberTypeOf(type);
		if (!picked || !today) return;
		setType.mutate(
			{
				userId,
				body: {
					type: picked,
					// The override applies to hourly types only. A switch to another
					// type drops it, so the server does not refuse the change.
					expectedSecondsOverride: isHourlyType(picked)
						? expectedSecondsOverride
						: null,
					// The change takes effect today and leaves past months as they were.
					effectiveFrom: today,
				},
			},
			{
				onSuccess: () => setHoursDraft(null),
				onError: (error) => notifyError("Could not update type", error),
			},
		);
	};

	const commitHours = () => {
		if (hoursDraft === null) return;
		const trimmed = hoursDraft.trim().replace(",", ".");
		const parsed = trimmed === "" ? null : Number(trimmed);
		if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0)) {
			setHoursDraft(null);
			return;
		}
		const seconds = parsed === null ? null : Math.round(parsed * 3600);
		if (seconds === person.expectedSecondsOverride) {
			setHoursDraft(null);
			return;
		}
		changeType(person.type, seconds);
	};

	const restoreOrArchive = () => {
		if (archived && person.emailUnconfirmed) {
			confirmAction({
				title: `Restore ${person.name}?`,
				message: confirmEmailMessage(person.email, true),
				action: "Restore and confirm",
				onConfirm: () => runArchive(false),
			});
			return;
		}
		if (archived) {
			runArchive(false);
			return;
		}
		confirmAction({
			title: `Archive ${person.name}?`,
			message:
				"An archived person keeps every entry and month. They drop out of reminders and other forward-looking screens. You can restore them later.",
			action: "Archive",
			onConfirm: () => runArchive(true),
		});
	};

	const runArchive = (archiving: boolean) =>
		archive.mutate(
			{ userId, archived: archiving },
			{
				onSuccess: (result) => {
					if (!archiving && result.emailConfirmed) {
						notify("Restored, address confirmed");
					}
				},
				onError: (error) => notifyError("Could not archive", error),
			},
		);

	return (
		<Screen
			topInset={false}
			refreshing={profile.isRefetching}
			onRefresh={refresh}
		>
			<Stack.Screen options={{ title: person.name }} />
			<SettingsSection>
				<DetailRow
					title={person.name}
					subtitle={`${person.email}${archived ? "\nArchived" : ""}`}
				/>
			</SettingsSection>

			{person.orgRole === "owner" ? (
				<SettingsSection title="Role">
					<SettingsValue title="Role" value="Owner" />
				</SettingsSection>
			) : (
				<ChoiceSection
					title="Role"
					footer={isSelf ? "You cannot change your own role." : undefined}
					options={ROLE_OPTIONS}
					value={person.orgRole === "admin" ? "admin" : "member"}
					disabled={isSelf || busy}
					onChange={(role) =>
						setRole.mutate(
							{ userId, body: { role } },
							{
								onError: (error) => notifyError("Could not update role", error),
							},
						)
					}
				/>
			)}

			<ChoiceSection
				title="Type"
				footer="The type decides who the compliance report and the reminders cover. A change takes effect today. Past months keep the type that the person held then. Overhead employees are left out of reminders."
				options={MEMBER_TYPE_OPTIONS}
				value={memberTypeOf(person.type)}
				disabled={busy || !today}
				onChange={(type) => changeType(type, person.expectedSecondsOverride)}
			/>

			{hourly ? (
				<View style={{ paddingHorizontal: SPACE.l }}>
					<Field
						label="Expected hours per month"
						hint="Leave it blank for no expected figure."
						value={hoursDraft ?? savedHours}
						onChangeText={setHoursDraft}
						onBlur={commitHours}
						onSubmitEditing={commitHours}
						keyboardType="decimal-pad"
						returnKeyType="done"
						placeholder="None"
						editable={!busy}
					/>
				</View>
			) : null}

			{typeHistory.length > 0 ? (
				<SettingsSection title="Type history">
					{typeHistory.map((row) => (
						<DetailRow
							key={`${row.type}-${row.effectiveFrom}`}
							title={typeLabelOf(row.type)}
							subtitle={[
								`From ${formatDay(row.effectiveFrom)}`,
								row.effectiveUntil
									? `until ${formatDay(row.effectiveUntil)}`
									: "now",
								row.expectedSecondsOverride === null
									? ""
									: `${hoursOf(row.expectedSecondsOverride)} h per month`,
							]
								.filter(Boolean)
								.join(", ")}
						/>
					))}
				</SettingsSection>
			) : null}

			<SettingsSection title="Start date">
				<PickerRow
					title="Start date"
					mode="date"
					value={person.startDate}
					display={person.startDate ? formatDay(person.startDate) : undefined}
					disabled={busy}
					onChange={(startDate) =>
						setStartDate.mutate(
							{ userId, body: { startDate } },
							{
								onError: (error) =>
									notifyError("Could not update start date", error),
							},
						)
					}
				/>
				{person.startDate ? (
					<ActionRow
						label="Clear start date"
						disabled={busy}
						onPress={() =>
							setStartDate.mutate(
								{ userId, body: { startDate: null } },
								{
									onError: (error) =>
										notifyError("Could not update start date", error),
								},
							)
						}
					/>
				) : null}
			</SettingsSection>

			{archived ? null : (
				<SettingsSection footer="The people that this person leads. The list is the Team Lead role.">
					<SettingsLink
						icon="team"
						title="Leads"
						value={
							person.leadsPeople > 0
								? peopleCount(person.leadsPeople)
								: "Nobody"
						}
						onPress={() =>
							router.push({
								pathname: "/workspace/people/[userId]/team",
								params: { userId },
							})
						}
					/>
				</SettingsSection>
			)}

			{canManage ? (
				<SettingsSection title="Actions">
					{!archived && person.emailUnconfirmed ? (
						<ActionRow
							label="Confirm email"
							icon="verified"
							busy={confirmEmail.isPending}
							disabled={busy}
							onPress={() =>
								confirmAction({
									title: `Confirm the address of ${person.name}?`,
									message: confirmEmailMessage(person.email, false),
									action: "Confirm",
									onConfirm: () =>
										confirmEmail.mutate(userId, {
											onSuccess: () => notify("Address confirmed"),
											onError: (error) =>
												notifyError("Could not confirm the address", error),
										}),
								})
							}
						/>
					) : null}
					<ActionRow
						label={archived ? "Restore" : "Archive"}
						icon={archived ? "restore" : "archive"}
						busy={archive.isPending}
						disabled={busy}
						onPress={restoreOrArchive}
					/>
					<ActionRow
						label="Remove"
						destructive
						disabled={busy}
						onPress={() =>
							confirmDestructive({
								title: `Remove ${person.name}?`,
								message: `${person.name} loses access to the workspace. Archive the person instead to keep their history in the list.`,
								action: "Remove",
								onConfirm: () =>
									remove.mutate(userId, {
										onSuccess: () => router.back(),
										onError: (error) =>
											notifyError("Could not remove member", error),
									}),
							})
						}
					/>
				</SettingsSection>
			) : null}
		</Screen>
	);
}

/** The text of the confirmation for a person who never signed in. */
const confirmEmailMessage = (email: string, restore: boolean) =>
	`They have never signed in, and nobody has confirmed their address. ${
		restore ? "Restoring them confirms" : "This confirms"
	} ${email}: whoever signs in with Google as that address becomes this person. Check it first.`;
