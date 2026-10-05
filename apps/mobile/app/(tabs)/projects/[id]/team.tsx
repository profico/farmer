import type { ProjectDetail, ProjectMember } from "@farmer/api-client";
import { Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Alert, View } from "react-native";

import { useAccess } from "../../../../src/api/capabilities";
import {
	type TeamChange,
	useAssignable,
	useChangeTeam,
	useProject,
	useProjectMembers,
} from "../../../../src/api/projects";
import {
	canActOnProjectRole,
	PROJECT_ROLES,
	type ProjectRole,
	projectPageAccess,
	roleLabel,
} from "../../../../src/projects/access";
import {
	ListCard,
	Note,
	SummaryRow,
} from "../../../../src/reports/components/disclosure";
import { MenuPicker } from "../../../../src/reports/components/menu-picker";
import { formatReportHours } from "../../../../src/reports/format";
import { dayLabel } from "../../../../src/reports/period";
import {
	EmptyState,
	ErrorBanner,
	ErrorState,
	Field,
	ListRow,
	SectionHeader,
	Skeleton,
} from "../../../../src/ui/components";
import { messageOf } from "../../../../src/ui/errors";
import { Icon } from "../../../../src/ui/icon";
import { Inset, Screen } from "../../../../src/ui/screen";
import {
	SettingsSection,
	SettingsValue,
} from "../../../../src/ui/settings-list";
import { usePalette } from "../../../../src/ui/theme";

/** One person on the team. Open, the row shows the roles to choose from
 *  and the removal, when the person who looks may act on this role. */
function MemberRow({
	member,
	open,
	onToggle,
	roles,
	manageable,
	busy,
	onChange,
}: {
	member: ProjectMember;
	open: boolean;
	onToggle: () => void;
	roles: ProjectRole[];
	manageable: boolean;
	busy: boolean;
	onChange: (change: TeamChange) => void;
}) {
	const palette = usePalette();
	const hint = PROJECT_ROLES.find((role) => role.value === member.role)?.hint;
	return (
		<View>
			<SummaryRow
				title={member.name}
				subtitle={[
					roleLabel(member.role),
					`${formatReportHours(member.allTimeSeconds)} h all-time`,
					member.lastEntry
						? `last ${dayLabel(member.lastEntry)}`
						: "no entries",
				].join(", ")}
				open={open}
				onToggle={onToggle}
			/>
			{open ? (
				<View>
					<ListRow
						title={member.email}
						subtitle={hint}
						accessibilityLabel={`${member.email}, ${hint ?? ""}`}
					/>
					{manageable ? (
						<>
							{PROJECT_ROLES.filter((role) => roles.includes(role.value)).map(
								(role) => {
									const selected = role.value === member.role;
									return (
										<ListRow
											key={role.value}
											title={role.label}
											subtitle={role.hint}
											selected={selected}
											accessibilityLabel={`Make ${member.name} ${role.label}`}
											onPress={
												selected || busy
													? undefined
													: () =>
															onChange({
																kind: "role",
																userId: member.userId,
																role: role.value,
															})
											}
											trailing={
												selected ? (
													<Icon
														name="check"
														size={20}
														color={palette.primary}
													/>
												) : undefined
											}
										/>
									);
								},
							)}
							<ListRow
								icon="delete"
								title="Remove from the project"
								accessibilityLabel={`Remove ${member.name} from the project`}
								onPress={
									busy
										? undefined
										: () =>
												Alert.alert(
													`Remove ${member.name}?`,
													"Removing someone keeps their history on the project; they just cannot log more time on it.",
													[
														{ text: "Cancel", style: "cancel" },
														{
															text: "Remove",
															style: "destructive",
															onPress: () =>
																onChange({
																	kind: "remove",
																	userId: member.userId,
																}),
														},
													],
												)
								}
							/>
						</>
					) : (
						<Note>
							{`Only a person of a higher rank can change ${member.name}.`}
						</Note>
					)}
				</View>
			) : null}
		</View>
	);
}

/** The roster, and the people who can join. */
function Roster({
	project,
	isAdmin,
}: {
	project: ProjectDetail;
	isAdmin: boolean;
}) {
	const palette = usePalette();
	const members = useProjectMembers(project.id, true);
	const assignable = useAssignable(project.id, true);
	const change = useChangeTeam(project.id);
	const [open, setOpen] = useState<string | null>(null);
	const [search, setSearch] = useState("");
	const roles = PROJECT_ROLES.map((role) => role.value).filter((role) =>
		canActOnProjectRole(isAdmin, project.role, role),
	);
	const [newRole, setNewRole] = useState<ProjectRole>("member");

	if (members.isPending) {
		return (
			<Inset>
				<Skeleton height={56} />
				<Skeleton height={56} />
			</Inset>
		);
	}
	if (members.isError) {
		return (
			<ErrorState
				error={members.error}
				onRetry={() => void members.refetch()}
			/>
		);
	}

	const onTeam = members.data
		.filter((member) => member.active)
		.sort((a, b) => a.name.localeCompare(b.name, "hr"));
	const onTeamIds = new Set(onTeam.map((member) => member.userId));
	const needle = search.trim().toLowerCase();
	const free = (assignable.data ?? [])
		.filter((person) => !onTeamIds.has(person.userId))
		.filter(
			(person) =>
				!needle ||
				[person.name, person.email].some((text) =>
					text.toLowerCase().includes(needle),
				),
		)
		.sort((a, b) => a.name.localeCompare(b.name, "hr"));
	const run = (next: TeamChange) =>
		change.mutate(next, {
			onSuccess: () => {
				if (next.kind === "remove") setOpen(null);
			},
		});

	return (
		<>
			{change.error ? (
				<Inset>
					<ErrorBanner message={messageOf(change.error) ?? ""} />
				</Inset>
			) : null}
			<SectionHeader>{`On the team (${onTeam.length})`}</SectionHeader>
			{onTeam.length === 0 ? (
				<EmptyState icon="team" title="Nobody is on this project yet." />
			) : (
				<ListCard>
					{onTeam.map((member) => (
						<MemberRow
							key={member.userId}
							member={member}
							open={open === member.userId}
							onToggle={() =>
								setOpen(open === member.userId ? null : member.userId)
							}
							roles={roles}
							manageable={canActOnProjectRole(
								isAdmin,
								project.role,
								member.role,
							)}
							busy={change.isPending}
							onChange={run}
						/>
					))}
				</ListCard>
			)}
			<Note>
				Removing someone keeps their history on the project; they just cannot
				log more time on it.
			</Note>

			<SectionHeader>Add a person</SectionHeader>
			<Inset>
				<MenuPicker
					label="Role for the person you add"
					options={PROJECT_ROLES.filter((role) => roles.includes(role.value))}
					value={roles.includes(newRole) ? newRole : "member"}
					onChange={setNewRole}
				/>
				<Field
					label="Search people"
					value={search}
					onChangeText={setSearch}
					placeholder="Name or email"
					autoCorrect={false}
					autoCapitalize="none"
					clearButtonMode="while-editing"
				/>
			</Inset>
			{assignable.isPending ? (
				<Inset>
					<Skeleton height={56} />
				</Inset>
			) : assignable.isError ? (
				<ErrorState
					error={assignable.error}
					onRetry={() => void assignable.refetch()}
				/>
			) : free.length === 0 ? (
				<EmptyState
					icon="people"
					title={needle ? "Nobody matches." : "Everyone is on the team"}
				/>
			) : (
				<ListCard>
					{free.map((person) => (
						<ListRow
							key={person.userId}
							icon="person"
							title={person.name}
							subtitle={person.email}
							accessibilityLabel={`Add ${person.name} as ${roleLabel(newRole)}`}
							onPress={
								change.isPending
									? undefined
									: () =>
											run({
												kind: "add",
												userId: person.userId,
												role: roles.includes(newRole) ? newRole : "member",
											})
							}
							trailing={<Icon name="add" size={22} color={palette.primary} />}
						/>
					))}
				</ListCard>
			)}
		</>
	);
}

/** A project's team: who is on it, at what role, with what each of them
 *  ever logged here. Changes save at once. Team Leads, PMs and admins. */
export default function ProjectTeamScreen() {
	const { id } = useLocalSearchParams<{ id: string }>();
	const access = useAccess();
	const { project, ...list } = useProject(id);

	const content = () => {
		if (list.isPending) {
			return (
				<Inset>
					<Skeleton height={56} />
					<Skeleton height={56} />
				</Inset>
			);
		}
		if (list.isError) {
			return (
				<ErrorState error={list.error} onRetry={() => void list.refetch()} />
			);
		}
		if (!project) {
			return (
				<EmptyState
					icon="folder"
					title="Project not found"
					message="You may no longer be on this project."
				/>
			);
		}
		const page = projectPageAccess(access.isAdmin, project.role);
		if (!page.canManageTeam) {
			return (
				<EmptyState
					icon="team"
					title="Team"
					message="The team is managed by the project's team leads and PMs."
				/>
			);
		}
		return (
			<>
				<Note>
					{`Who may log time on ${project.name}, and who runs it. A PM manages the project; a Team Lead here holds it as a PM does. Changes save straight away.`}
				</Note>
				<SettingsSection>
					<SettingsValue
						title="Open to everyone"
						subtitle={
							page.canManageSettings
								? "Change it in the project's settings"
								: "The project's PMs change this"
						}
						value={project.openToOrg ? "On" : "Off"}
					/>
				</SettingsSection>
				<Roster project={project} isAdmin={access.isAdmin} />
			</>
		);
	};

	return (
		<>
			<Stack.Screen
				options={{ title: project ? `${project.name}: Team` : "Team" }}
			/>
			<Screen topInset={false}>{content()}</Screen>
		</>
	);
}
