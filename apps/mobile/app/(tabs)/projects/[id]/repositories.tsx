import type { AvailableRepository } from "@farmer/api-client";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";

import { useAccess } from "../../../../src/api/capabilities";
import {
	useAvailableRepositories,
	useLinkRepository,
	useProject,
	useProjectRepositories,
	useRefreshRepositories,
	useUnlinkRepository,
} from "../../../../src/api/projects";
import { useIntegrations } from "../../../../src/api/you";
import {
	formatAge,
	SEARCH_FIRST_THRESHOLD,
} from "../../../../src/projects/model";
import {
	ActionButton,
	EmptyState,
	ErrorState,
	IconButton,
	Text,
} from "../../../../src/ui/components";
import { messageOf } from "../../../../src/ui/errors";
import { Screen } from "../../../../src/ui/screen";
import { SearchField } from "../../../../src/ui/search-field";
import { SettingsSection } from "../../../../src/ui/settings-list";
import { usePalette } from "../../../../src/ui/theme";
import { SPACE } from "../../../../src/ui/type";
import {
	ActionRow,
	Badge,
	CustomRow,
	ListSkeleton,
	NoteRow,
	notifyError,
} from "../../../../src/workspace/components";

const matches = (search: string, fullName: string) =>
	fullName.toLowerCase().includes(search.trim().toLowerCase());

/** The name of a repository, with "Private" beside it for a private one. */
function RepositoryName({
	fullName,
	isPrivate,
	muted,
}: {
	fullName: string;
	isPrivate: boolean;
	muted?: boolean;
}) {
	const palette = usePalette();
	return (
		<View
			style={{
				flex: 1,
				flexDirection: "row",
				alignItems: "center",
				gap: SPACE.s,
			}}
		>
			<View style={{ flexShrink: 1 }}>
				<Text
					variant="bodyLarge"
					color={muted ? palette.onSurfaceVariant : palette.onSurface}
					numberOfLines={1}
				>
					{fullName}
				</Text>
			</View>
			{isPrivate ? <Badge label="Private" /> : null}
		</View>
	);
}

/**
 * The repositories linked to one project, and the list to link one more,
 * as the GitHub tab of a project on the web. A repository belongs to one
 * project in the workspace, so a repository that another project holds
 * names that project in place of a Link button.
 */
function Repositories({
	projectId,
	projectName,
}: {
	projectId: string;
	projectName: string;
}) {
	const router = useRouter();
	const palette = usePalette();
	const integrations = useIntegrations();
	const connected = integrations.data?.github.connected === true;
	const linked = useProjectRepositories(projectId, true);
	const available = useAvailableRepositories(connected);
	const link = useLinkRepository(projectId, projectName);
	const unlink = useUnlinkRepository(projectId);
	const refresh = useRefreshRepositories();
	const [search, setSearch] = useState("");

	// Read the clock again each minute, so "Updated 3 min ago" counts on.
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 60_000);
		return () => clearInterval(timer);
	}, []);

	const status = () => {
		if (integrations.isPending || linked.isPending) return <ListSkeleton />;
		if (integrations.isError) {
			return (
				<ErrorState
					error={integrations.error}
					onRetry={() => void integrations.refetch()}
				/>
			);
		}
		if (!connected) {
			return (
				<EmptyState
					icon="link"
					title="GitHub is not connected"
					message="Connect your GitHub account to link repositories to this project."
					action={
						<ActionButton
							label="Go to Integrations"
							variant="outlined"
							onPress={() => router.push("/you/integrations")}
						/>
					}
				/>
			);
		}
		if (linked.isError) {
			return (
				<ErrorState
					error={linked.error}
					onRetry={() => void linked.refetch()}
				/>
			);
		}
		return null;
	};
	const blocked = status();
	if (blocked || !linked.data) {
		return <Screen topInset={false}>{blocked}</Screen>;
	}

	const searching = search.trim() !== "";
	const linkedRows = linked.data.filter((repo) =>
		matches(search, repo.fullName),
	);
	const linking = link.isPending ? link.variables : undefined;
	const showLinking =
		linking !== undefined &&
		!linked.data.some((repo) => repo.githubRepoId === linking.githubRepoId) &&
		matches(search, linking.fullName);
	// Every repository that this project does not hold, the ones of other
	// projects too: they answer "why can I not find it?".
	const linkable = (available.data?.repositories ?? []).filter(
		(repo) =>
			repo.linkedTo?.projectId !== projectId && matches(search, repo.fullName),
	);
	const awaitingSearch = !searching && linkable.length > SEARCH_FIRST_THRESHOLD;
	const fetchedAt = available.data?.fetchedAt;

	const linkRepository = (repo: AvailableRepository) =>
		link.mutate(repo, {
			onError: (error) => notifyError("Could not link the repository", error),
		});

	const emptyLinkable = () => {
		if (available.isError) return messageOf(available.error) ?? "";
		if (!available.data) return "Loading the repositories.";
		return searching
			? "No repositories match your search."
			: "No more repositories to link.";
	};

	return (
		<Screen
			topInset={false}
			refreshing={linked.isRefetching || available.isRefetching}
			onRefresh={() => {
				void linked.refetch();
				void available.refetch();
			}}
		>
			<SearchField
				value={search}
				onChangeText={setSearch}
				placeholder="Search repositories"
			/>
			<SettingsSection title="Linked repositories">
				{showLinking && linking ? (
					<CustomRow accessibilityLabel={`${linking.fullName}, linking`}>
						<RepositoryName
							fullName={linking.fullName}
							isPrivate={linking.private}
							muted
						/>
						<Text variant="bodySmall" color={palette.onSurfaceVariant}>
							Linking
						</Text>
					</CustomRow>
				) : null}
				{linkedRows.map((repo) => (
					<CustomRow key={repo.id}>
						<RepositoryName fullName={repo.fullName} isPrivate={repo.private} />
						<IconButton
							icon="close"
							label={`Unlink ${repo.fullName}`}
							disabled={unlink.isPending}
							onPress={() =>
								unlink.mutate(repo, {
									onError: (error) =>
										notifyError("Could not unlink the repository", error),
								})
							}
						/>
					</CustomRow>
				))}
				{linkedRows.length === 0 && !showLinking ? (
					<NoteRow>
						{searching
							? "No linked repositories match your search."
							: "No repositories linked yet."}
					</NoteRow>
				) : null}
			</SettingsSection>
			<SettingsSection
				title="Link a repository"
				footer={
					fetchedAt
						? `Updated ${formatAge(fetchedAt, now)}. Refresh to find a repository that was made after that.`
						: undefined
				}
			>
				<ActionRow
					label="Refresh repositories"
					icon="refresh"
					busy={refresh.isPending}
					disabled={link.isPending || !available.data}
					onPress={() =>
						refresh.mutate(undefined, {
							onError: (error) =>
								notifyError("Could not refresh the repositories", error),
						})
					}
				/>
				{awaitingSearch ? (
					<NoteRow>
						{`Search to find one of ${linkable.length} repositories.`}
					</NoteRow>
				) : linkable.length === 0 ? (
					<NoteRow>{emptyLinkable()}</NoteRow>
				) : (
					linkable.map((repo) => (
						<CustomRow key={repo.githubRepoId}>
							<RepositoryName
								fullName={repo.fullName}
								isPrivate={repo.private}
							/>
							{repo.linkedTo ? (
								<View style={{ maxWidth: "40%" }}>
									<Text
										variant="bodySmall"
										color={palette.onSurfaceVariant}
										numberOfLines={1}
									>
										{`On ${repo.linkedTo.projectName ?? "another project"}`}
									</Text>
								</View>
							) : (
								<ActionButton
									label="Link"
									variant="outlined"
									disabled={link.isPending}
									onPress={() => linkRepository(repo)}
								/>
							)}
						</CustomRow>
					))
				)}
			</SettingsSection>
		</Screen>
	);
}

/** The GitHub repositories of a project. Admins only, as on the web. */
export default function ProjectRepositoriesScreen() {
	const { id } = useLocalSearchParams<{ id: string }>();
	const access = useAccess();
	const { project, ...list } = useProject(id);

	const content = () => {
		if (access.ready && !(access.isAdmin && access.setupApi)) {
			return (
				<Screen topInset={false}>
					<EmptyState
						icon="link"
						title="Admins only"
						message="Only an admin can link repositories to a project."
					/>
				</Screen>
			);
		}
		if (list.isPending || !access.ready) {
			return (
				<Screen topInset={false}>
					<ListSkeleton />
				</Screen>
			);
		}
		if (list.isError) {
			return (
				<Screen topInset={false}>
					<ErrorState error={list.error} onRetry={() => void list.refetch()} />
				</Screen>
			);
		}
		if (!project) {
			return (
				<Screen topInset={false}>
					<EmptyState
						icon="folder"
						title="Project not found"
						message="The project may be gone."
					/>
				</Screen>
			);
		}
		return (
			<Repositories
				key={project.id}
				projectId={project.id}
				projectName={project.name}
			/>
		);
	};

	return (
		<>
			<Stack.Screen
				options={{ title: project ? `${project.name}: GitHub` : "GitHub" }}
			/>
			{content()}
		</>
	);
}
