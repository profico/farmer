import type { ProjectDetail } from "@farmer/api-client";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Alert, View } from "react-native";

import { useAccess } from "../../../../src/api/capabilities";
import {
	useArchiveProject,
	useClients,
	useProject,
	useUpdateProject,
} from "../../../../src/api/projects";
import { projectPageAccess } from "../../../../src/projects/access";
import { ProjectFields } from "../../../../src/projects/components/project-fields";
import { useIconUpload } from "../../../../src/projects/icon-upload";
import {
	formOf,
	isEmptyPatch,
	isUploadedIcon,
	patchOf,
	type ProjectForm,
	validateForm,
} from "../../../../src/projects/model";
import {
	ActionButton,
	EmptyState,
	ErrorBanner,
	ErrorState,
	Skeleton,
	Text,
} from "../../../../src/ui/components";
import { messageOf } from "../../../../src/ui/errors";
import { Inset, Screen } from "../../../../src/ui/screen";
import {
	SettingsLink,
	SettingsSection,
	SettingsSwitch,
} from "../../../../src/ui/settings-list";
import { usePalette } from "../../../../src/ui/theme";
import { SPACE } from "../../../../src/ui/type";

/** The form, once the project and the clients are read. Nothing saves
 *  until Save, except "Open to everyone" and Archive, which act at once. */
function SettingsForm({ project }: { project: ProjectDetail }) {
	const palette = usePalette();
	const clients = useClients();
	const update = useUpdateProject(project.id);
	const openToOrg = useUpdateProject(project.id);
	const archive = useArchiveProject();
	const [saved, setSaved] = useState<ProjectForm>(() => formOf(project));
	const [form, setForm] = useState<ProjectForm>(saved);
	const [tried, setTried] = useState(false);
	const archived = project.status === "archived";
	const router = useRouter();
	const access = useAccess();
	const upload = useIconUpload((icon) =>
		setForm((current) => ({ ...current, icon })),
	);

	const errors = tried ? validateForm(form) : {};
	const patch = patchOf(saved, form);
	const dirty = !isEmptyPatch(patch);

	const save = () => {
		setTried(true);
		if (Object.keys(validateForm(form)).length > 0) return;
		update.mutate(patch, {
			onSuccess: (next) => {
				const baseline = formOf(next);
				setSaved(baseline);
				setForm(baseline);
				setTried(false);
			},
		});
	};

	const changeStatus = () =>
		Alert.alert(
			archived ? `Restore ${project.name}?` : `Archive ${project.name}?`,
			archived
				? "People assigned to it can log time on it again."
				: "Nobody can log more time on it until it is restored. Everything already logged stays where it is.",
			[
				{ text: "Cancel", style: "cancel" },
				{
					text: archived ? "Restore" : "Archive",
					style: archived ? "default" : "destructive",
					onPress: () =>
						archive.mutate(
							{ id: project.id, archive: !archived },
							{
								onError: (error) =>
									Alert.alert(
										"Could not change the project's status",
										messageOf(error) ?? "",
									),
							},
						),
				},
			],
		);

	if (clients.isPending) {
		return (
			<Inset>
				<Skeleton height={56} />
				<Skeleton height={56} />
				<Skeleton height={56} />
			</Inset>
		);
	}
	if (clients.isError) {
		return (
			<ErrorState
				error={clients.error}
				onRetry={() => void clients.refetch()}
			/>
		);
	}
	// An archived client is not in the list of active clients, but it can
	// still own the project.
	const clientList = clients.data.some(
		(client) => client.id === project.client.id,
	)
		? clients.data
		: [
				...clients.data,
				{
					id: project.client.id,
					name: project.client.name,
					isInternal: false,
					archivedAt: null,
				},
			];

	return (
		<>
			<Inset>
				<ProjectFields
					form={form}
					onChange={setForm}
					errors={errors}
					clients={clientList}
					showMoney
					iconIsUpload={isUploadedIcon(form.icon)}
					upload={upload}
				/>
				{update.error ? (
					<ErrorBanner message={messageOf(update.error) ?? ""} />
				) : null}
				{dirty ? (
					<View
						style={{
							flexDirection: "row",
							alignItems: "center",
							gap: SPACE.s,
							flexWrap: "wrap",
						}}
					>
						<View style={{ flex: 1 }}>
							<Text variant="bodyMedium" color={palette.onSurfaceVariant}>
								Unsaved changes
							</Text>
						</View>
						<ActionButton
							label="Discard"
							variant="text"
							disabled={update.isPending}
							onPress={() => {
								setForm(saved);
								setTried(false);
								update.reset();
							}}
						/>
						<ActionButton
							label={update.isPending ? "Saving" : "Save changes"}
							disabled={update.isPending}
							onPress={save}
						/>
					</View>
				) : null}
			</Inset>
			<SettingsSection
				title="Access"
				footer="Everyone in the organization can log time here, on the team or not. Nobody gains a role from it."
			>
				<SettingsSwitch
					title="Open to everyone"
					value={project.openToOrg}
					disabled={openToOrg.isPending}
					onValueChange={(value) =>
						openToOrg.mutate(
							{ openToOrg: value },
							{
								onError: (error) =>
									Alert.alert("Could not save", messageOf(error) ?? ""),
							},
						)
					}
				/>
			</SettingsSection>
			{access.isAdmin && access.setupApi ? (
				<SettingsSection
					title="GitHub"
					footer="The commits and pull requests of a linked repository can go on the time entries of this project."
				>
					<SettingsLink
						icon="link"
						tint="gray"
						title="Repositories"
						onPress={() =>
							router.push({
								pathname: "/projects/[id]/repositories",
								params: { id: project.id },
							})
						}
					/>
				</SettingsSection>
			) : null}
			<SettingsSection
				title={archived ? "Restore" : "Archive"}
				footer={
					archived
						? 'Restoring puts the project back in the pickers and in "Active projects only".'
						: 'Archiving hides the project from the pickers and from "Active projects only". Nothing is deleted; its history stays in every report, and it can be restored at any time.'
				}
			>
				<SettingsLink
					icon={archived ? "repeat" : "delete"}
					tint={archived ? "green" : "red"}
					title={archived ? "Restore project" : "Archive project"}
					destructive={!archived}
					onPress={changeStatus}
				/>
			</SettingsSection>
		</>
	);
}

/** A project's settings, for its PMs and the admins. */
export default function ProjectSettingsScreen() {
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
		if (!projectPageAccess(access.isAdmin, project.role).canManageSettings) {
			return (
				<EmptyState
					icon="settings"
					title="Settings"
					message="The settings are managed by the project's PMs."
				/>
			);
		}
		// A key per project, so the form starts again from a project that
		// another screen opened.
		return <SettingsForm key={project.id} project={project} />;
	};

	return (
		<>
			<Stack.Screen
				options={{ title: project ? `${project.name}: Settings` : "Settings" }}
			/>
			<Screen topInset={false}>{content()}</Screen>
		</>
	);
}
