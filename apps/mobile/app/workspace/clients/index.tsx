import { Stack, useRouter } from "expo-router";
import { useState } from "react";

import { useAccess } from "../../../src/api/capabilities";
import { useClients } from "../../../src/api/workspace";
import { EmptyState, ErrorState, IconButton } from "../../../src/ui/components";
import { Screen } from "../../../src/ui/screen";
import { SettingsSection } from "../../../src/ui/settings-list";
import { useClientArchive } from "../../../src/workspace/catalog/archive";
import { matchesSearch } from "../../../src/workspace/catalog/search";
import {
	Badge,
	DetailRow,
	ListSkeleton,
	NoteRow,
	SearchField,
} from "../../../src/workspace/components";

/** The clients of the workspace: active ones, then the archived ones. A
 *  person who leads a project may add a client. Only an admin may rename,
 *  archive or restore one, as on the web. */
export default function ClientsScreen() {
	const router = useRouter();
	const access = useAccess();
	const clients = useClients();
	const archive = useClientArchive();
	const [query, setQuery] = useState("");

	const matching = (clients.data ?? []).filter((client) =>
		matchesSearch(query, [client.name]),
	);
	const active = matching.filter((client) => !client.archivedAt);
	const archived = matching.filter((client) => client.archivedAt);
	const searching = query.trim() !== "";

	const edit = (id: string) =>
		router.push({ pathname: "/workspace/clients/edit", params: { id } });

	const row = (client: (typeof matching)[number]) => (
		<DetailRow
			key={client.id}
			title={client.name}
			subtitle={client.isInternal ? "Internal client" : undefined}
			muted={Boolean(client.archivedAt)}
			trailing={
				client.isInternal ? <Badge label="Internal" tone="accent" /> : undefined
			}
			onPress={access.isAdmin ? () => edit(client.id) : undefined}
			actions={
				access.isAdmin
					? [
							{
								label: "Edit",
								icon: "edit",
								onPress: () => edit(client.id),
							},
							// The Internal client cannot be archived, as in its sheet.
							!client.isInternal &&
								(client.archivedAt
									? {
											label: "Restore",
											icon: "restore",
											onPress: () => archive.restore(client),
										}
									: {
											label: "Archive",
											icon: "archive",
											destructive: true,
											onPress: () => archive.confirmArchive(client),
										}),
						]
					: []
			}
		/>
	);

	return (
		<>
			<Stack.Screen
				options={{
					title: "Clients",
					headerRight: access.canManageClients
						? () => (
								<IconButton
									icon="add"
									label="New client"
									onPress={() => router.push("/workspace/clients/edit")}
								/>
							)
						: undefined,
				}}
			/>
			<Screen
				topInset={false}
				refreshing={clients.isRefetching}
				onRefresh={() => void clients.refetch()}
			>
				{clients.isPending ? (
					<ListSkeleton />
				) : clients.isError ? (
					<ErrorState
						error={clients.error}
						onRetry={() => void clients.refetch()}
					/>
				) : (
					<>
						<SearchField
							value={query}
							onChangeText={setQuery}
							placeholder="Search clients"
						/>
						{active.length === 0 && archived.length === 0 ? (
							<EmptyState
								icon="client"
								title={searching ? "No clients match" : "No clients yet"}
								message={
									searching
										? "No clients match your search."
										: "Every project belongs to a client."
								}
							/>
						) : (
							<SettingsSection
								footer={`Every project belongs to a client, which is what makes the Time report's "by client" view add up. The Internal client is created automatically and holds work that is never invoiced.`}
							>
								{active.length > 0 ? (
									active.map(row)
								) : (
									<NoteRow>
										{searching
											? "Only archived clients match your search."
											: "No active clients."}
									</NoteRow>
								)}
							</SettingsSection>
						)}
						{archived.length > 0 ? (
							<SettingsSection title="Archived">
								{archived.map(row)}
							</SettingsSection>
						) : null}
					</>
				)}
			</Screen>
		</>
	);
}
