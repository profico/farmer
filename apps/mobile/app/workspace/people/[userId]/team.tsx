import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";

import {
	usePeople,
	useSetTeamLeadPeople,
	useTeamLeadPeople,
} from "../../../../src/api/workspace";
import {
	ActionButton,
	EmptyState,
	ErrorState,
} from "../../../../src/ui/components";
import { Screen } from "../../../../src/ui/screen";
import {
	SettingsChoice,
	SettingsSection,
} from "../../../../src/ui/settings-list";
import {
	ListSkeleton,
	notify,
	notifyError,
	SearchField,
} from "../../../../src/workspace/components";
import { peopleCount } from "../../../../src/workspace/format";
import { paramOf } from "../../../../src/workspace/params";
import { matchesSearch } from "../../../../src/workspace/people/labels";

/** The people that one team lead leads. The list is the role: the lead sees
 *  everything about these people. */
export default function TeamLeadPeopleScreen() {
	const router = useRouter();
	const userId =
		paramOf(useLocalSearchParams<{ userId: string }>().userId) ?? "";
	const people = usePeople();
	const current = useTeamLeadPeople(userId);
	const save = useSetTeamLeadPeople();
	const [query, setQuery] = useState("");
	const [edited, setEdited] = useState<Set<string> | null>(null);

	const lead = people.data?.find((person) => person.userId === userId);
	const name = lead?.name ?? "This person";
	const saved = new Set((current.data ?? []).map((person) => person.userId));
	// The edits start from the saved list once it arrives.
	const picked = edited ?? saved;
	const changed =
		edited !== null &&
		(edited.size !== saved.size || [...edited].some((id) => !saved.has(id)));

	const candidates = (people.data ?? [])
		.filter((person) => person.userId !== userId && person.archivedAt === null)
		.filter((person) => matchesSearch(query, [person.name, person.email]));

	const toggle = (id: string) => {
		const next = new Set(picked);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		setEdited(next);
	};

	const submit = () =>
		save.mutate(
			{ userId, personUserIds: [...picked] },
			{
				onSuccess: () => {
					notify(`Saved ${name}'s people`);
					router.back();
				},
				onError: (error) => notifyError("Could not save the people", error),
			},
		);

	const error = people.error ?? current.error;
	const refresh = () => {
		void people.refetch();
		void current.refetch();
	};

	return (
		<Screen
			topInset={false}
			refreshing={people.isRefetching || current.isRefetching}
			onRefresh={refresh}
		>
			<Stack.Screen
				options={{
					title: `${name}'s people`,
					headerRight: () => (
						<ActionButton
							label="Save"
							onPress={submit}
							disabled={!changed || save.isPending}
						/>
					),
				}}
			/>
			<SearchField
				value={query}
				onChangeText={setQuery}
				placeholder="Search people..."
			/>
			{error ? (
				<ErrorState error={error} onRetry={refresh} />
			) : people.isPending || current.isPending ? (
				<ListSkeleton />
			) : candidates.length === 0 ? (
				query.trim() === "" ? (
					<EmptyState
						icon="people"
						title="Nobody else is in the workspace"
						message="Invite people first. Then come back to choose whom this person leads."
					/>
				) : (
					<EmptyState icon="search" title="Nobody matches your search." />
				)
			) : (
				<SettingsSection
					title={
						picked.size === 0
							? "Nobody - not a Team Lead"
							: peopleCount(picked.size)
					}
					footer={`${name} sees everything about the people picked here: their time on every project, their Tracking status, their time off. ${name} also runs any project where they hold a Team Lead assignment as a PM. A plain Member assignment stays a Member. A person can be on the lists of several leads.`}
				>
					{candidates.map((person) => (
						<SettingsChoice
							key={person.userId}
							title={person.name}
							subtitle={person.email}
							selected={picked.has(person.userId)}
							onPress={() => toggle(person.userId)}
						/>
					))}
				</SettingsSection>
			)}
		</Screen>
	);
}
