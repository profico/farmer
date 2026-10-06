import type { Invitation, Person } from "@farmer/api-client";
import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import {
	useCancelInvitation,
	useInvitations,
	usePeople,
	useResendInvitation,
} from "../../../src/api/workspace";
import { HeaderActions } from "../../../src/navigation/header-actions";
import { EmptyState, ErrorState, Text } from "../../../src/ui/components";
import { Screen } from "../../../src/ui/screen";
import { SegmentedControl } from "../../../src/ui/segmented";
import { SettingsSection } from "../../../src/ui/settings-list";
import { usePalette } from "../../../src/ui/theme";
import { SPACE } from "../../../src/ui/type";
import {
	ActionRow,
	Badge,
	type BadgeTone,
	confirmDestructive,
	DetailRow,
	ListSkeleton,
	notify,
	notifyError,
	SearchField,
} from "../../../src/workspace/components";
import {
	matchesSearch,
	typeLabelOf,
} from "../../../src/workspace/people/labels";

type Filter = "active" | "archived" | "invited";

const FILTERS = [
	{ value: "active", label: "Active" },
	{ value: "archived", label: "Archived" },
	{ value: "invited", label: "Invited" },
] satisfies { value: Filter; label: string }[];

/** The people of the workspace, and the invitations that nobody accepted. */
export default function PeopleScreen() {
	const router = useRouter();
	const people = usePeople();
	const invitations = useInvitations();
	const [query, setQuery] = useState("");
	const [filter, setFilter] = useState<Filter>("active");

	const refreshing = people.isRefetching || invitations.isRefetching;
	const refresh = () => {
		void people.refetch();
		void invitations.refetch();
	};

	const matching = (people.data ?? []).filter((person) =>
		matchesSearch(query, [person.name, person.email]),
	);
	const active = matching.filter((person) => person.archivedAt === null);
	const archived = matching.filter((person) => person.archivedAt !== null);
	const shownInvitations = (invitations.data ?? []).filter((invitation) =>
		matchesSearch(query, [invitation.email]),
	);
	const searching = query.trim() !== "";

	return (
		<Screen topInset={false} refreshing={refreshing} onRefresh={refresh}>
			<Stack.Screen
				options={{
					title: "People",
				}}
			/>
			<HeaderActions
				actions={[
					{
						icon: "add",
						label: "Invite a person",
						onPress: () => router.push("/workspace/people/invite"),
					},
				]}
			/>
			<View style={{ paddingHorizontal: SPACE.l }}>
				<SegmentedControl
					options={FILTERS}
					value={filter}
					onChange={setFilter}
				/>
			</View>
			<SearchField
				value={query}
				onChangeText={setQuery}
				placeholder="Search people..."
			/>
			{filter === "invited" ? (
				<InvitationsSection
					loading={invitations.isPending}
					error={invitations.error}
					onRetry={refresh}
					invitations={shownInvitations}
					searching={searching}
				/>
			) : people.isPending ? (
				<ListSkeleton />
			) : people.error ? (
				<ErrorState error={people.error} onRetry={refresh} />
			) : (
				<PeopleSection
					people={filter === "active" ? active : archived}
					filter={filter}
					searching={searching}
					onlyArchivedMatch={active.length === 0 && archived.length > 0}
				/>
			)}
		</Screen>
	);
}

function PeopleSection({
	people,
	filter,
	searching,
	onlyArchivedMatch,
}: {
	people: Person[];
	filter: "active" | "archived";
	searching: boolean;
	onlyArchivedMatch: boolean;
}) {
	const router = useRouter();
	if (people.length === 0) {
		if (searching) {
			return (
				<EmptyState
					icon="search"
					title={
						filter === "active" && onlyArchivedMatch
							? "Only archived people match your search."
							: "Nobody matches your search."
					}
				/>
			);
		}
		return (
			<EmptyState
				icon="people"
				title={filter === "active" ? "No people yet" : "Nobody is archived"}
			/>
		);
	}
	return (
		<SettingsSection
			footer={
				filter === "archived"
					? "An archived person keeps every entry. They drop out of reminders and reports from now on."
					: undefined
			}
		>
			{people.map((person) => (
				<DetailRow
					key={person.userId}
					title={person.name}
					subtitle={`${person.email}\n${typeLabelOf(person.type)}`}
					muted={person.archivedAt !== null}
					trailing={<PersonBadges person={person} />}
					onPress={() =>
						router.push({
							pathname: "/workspace/people/[userId]",
							params: { userId: person.userId },
						})
					}
				/>
			))}
		</SettingsSection>
	);
}

function PersonBadges({ person }: { person: Person }) {
	const badges: { label: string; tone: BadgeTone }[] = [];
	if (person.archivedAt !== null) {
		badges.push({ label: "Archived", tone: "neutral" });
	} else if (person.claimPending) {
		badges.push({ label: "Not joined yet", tone: "accent" });
	}
	if (person.orgRole === "owner")
		badges.push({ label: "Owner", tone: "success" });
	if (person.orgRole === "admin")
		badges.push({ label: "Admin", tone: "accent" });
	return (
		<View style={{ alignItems: "flex-end", gap: SPACE.xs }}>
			{badges.map((badge) => (
				<Badge key={badge.label} label={badge.label} tone={badge.tone} />
			))}
		</View>
	);
}

function InvitationsSection({
	loading,
	error,
	onRetry,
	invitations,
	searching,
}: {
	loading: boolean;
	error: Error | null;
	onRetry: () => void;
	invitations: Invitation[];
	searching: boolean;
}) {
	const palette = usePalette();
	const resend = useResendInvitation();
	const cancel = useCancelInvitation();
	if (loading) return <ListSkeleton />;
	if (error) return <ErrorState error={error} onRetry={onRetry} />;
	if (invitations.length === 0) {
		return (
			<EmptyState
				icon="inbox"
				title={
					searching ? "Nobody matches your search." : "No pending invitations"
				}
			/>
		);
	}
	return (
		<View style={{ gap: SPACE.l }}>
			<View style={{ paddingHorizontal: SPACE.xl }}>
				<Text variant="titleSmall" color={palette.primary}>
					Pending invitations
				</Text>
			</View>
			{invitations.map((invitation) => (
				<SettingsSection key={invitation.id}>
					<DetailRow
						title={invitation.email}
						subtitle={[roleLabelOf(invitation.role), deliveryError(invitation)]
							.filter(Boolean)
							.join("\n")}
						trailing={<DeliveryBadge invitation={invitation} />}
					/>
					<ActionRow
						label="Resend"
						icon="send"
						busy={resend.isPending && resend.variables === invitation.id}
						disabled={resend.isPending}
						onPress={() =>
							resend.mutate(invitation.id, {
								onSuccess: () => notify("Invitation sent again"),
								onError: (failure) =>
									notifyError("Could not resend invitation", failure),
							})
						}
					/>
					<ActionRow
						label="Cancel"
						destructive
						disabled={cancel.isPending}
						onPress={() =>
							confirmDestructive({
								title: "Cancel the invitation?",
								message: `${invitation.email} can no longer join with this invitation.`,
								action: "Cancel invitation",
								onConfirm: () =>
									cancel.mutate(invitation.id, {
										onError: (failure) =>
											notifyError("Could not cancel invitation", failure),
									}),
							})
						}
					/>
				</SettingsSection>
			))}
		</View>
	);
}

const roleLabelOf = (role: string | null) =>
	role === "admin" ? "Admin" : role === "member" ? "Member" : (role ?? "");

/** The reason of a failed email, as the provider gave it. */
const deliveryError = (invitation: Invitation) =>
	invitation.emailDelivery?.status === "failed"
		? (invitation.emailDelivery.error ?? "")
		: "";

/** Whether the invitation email left. Nothing for an invitation from before
 *  the delivery was tracked. */
function DeliveryBadge({ invitation }: { invitation: Invitation }) {
	const delivery = invitation.emailDelivery;
	if (!delivery) return null;
	if (delivery.status === "sending") return <Badge label="Sending..." />;
	if (delivery.status === "sent")
		return <Badge label="Email sent" tone="accent" />;
	return <Badge label="Email failed" tone="error" />;
}
