import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";

import { useAccess } from "../../../src/api/capabilities";
import {
	useClients,
	useCreateClient,
	useRenameClient,
} from "../../../src/api/workspace";
import { Sheet } from "../../../src/forms/sheet";
import {
	EmptyState,
	ErrorBanner,
	Field,
	Skeleton,
} from "../../../src/ui/components";
import { messageOf } from "../../../src/ui/errors";
import { SettingsSection } from "../../../src/ui/settings-list";
import { useClientArchive } from "../../../src/workspace/catalog/archive";
import { ActionRow, NoteRow } from "../../../src/workspace/components";
import { paramOf } from "../../../src/workspace/params";

const NAME_MAX_LENGTH = 120;

/** A new client (no `id`), or the rename of one (`id`). The sheet also
 *  holds Archive and Restore, which only an admin may use. */
export default function ClientSheet() {
	const params = useLocalSearchParams<{ id?: string }>();
	const id = paramOf(params.id);
	const clients = useClients();
	const access = useAccess();
	const title = id ? "Rename client" : "New client";

	if (!id) {
		return <ClientForm id={null} name="" isInternal={false} archived={false} />;
	}
	if (clients.isPending) {
		return (
			<Sheet title={title} actionLabel="Save" onAction={() => undefined} busy>
				<Skeleton height={56} radius={16} />
			</Sheet>
		);
	}
	const client = clients.data?.find((row) => row.id === id);
	if (!client || !access.isAdmin) {
		return (
			<Sheet
				title={title}
				actionLabel="Save"
				onAction={() => undefined}
				actionDisabled
			>
				<EmptyState
					icon="client"
					title={client ? "Not allowed" : "This client is gone"}
					message={
						client
							? "Only an admin can change a client."
							: "It was changed or removed somewhere else."
					}
				/>
			</Sheet>
		);
	}
	return (
		<ClientForm
			id={client.id}
			name={client.name}
			isInternal={client.isInternal}
			archived={Boolean(client.archivedAt)}
		/>
	);
}

function ClientForm({
	id,
	name: initialName,
	isInternal,
	archived,
}: {
	id: string | null;
	name: string;
	isInternal: boolean;
	archived: boolean;
}) {
	const router = useRouter();
	const create = useCreateClient();
	const rename = useRenameClient();
	const archive = useClientArchive();
	const [name, setName] = useState(initialName);
	const trimmed = name.trim();
	const busy = create.isPending || rename.isPending || archive.pending;
	const failure = messageOf(create.error ?? rename.error);

	const save = () => {
		if (trimmed === "") return;
		const done = { onSuccess: () => router.back() };
		if (id) rename.mutate({ id, body: { name: trimmed } }, done);
		else create.mutate({ name: trimmed }, done);
	};

	return (
		<Sheet
			title={id ? "Rename client" : "New client"}
			actionLabel={id ? "Save" : "Create"}
			onAction={save}
			busy={busy}
			actionDisabled={
				trimmed === "" || (id !== null && trimmed === initialName)
			}
		>
			{failure ? <ErrorBanner message={failure} /> : null}
			<Field
				label="Name"
				value={name}
				onChangeText={setName}
				maxLength={NAME_MAX_LENGTH}
				returnKeyType="done"
				onSubmitEditing={save}
			/>
			{id ? (
				<SettingsSection>
					{isInternal ? (
						// The internal client holds the work that is never invoiced.
						// Archiving it would strand every project of that kind.
						<NoteRow>
							The Internal client cannot be archived. It holds work that is
							never invoiced.
						</NoteRow>
					) : archived ? (
						<ActionRow
							label="Restore client"
							icon="restore"
							onPress={() => id && archive.restore({ id }, () => router.back())}
							busy={archive.pending}
						/>
					) : (
						<ActionRow
							label="Archive client"
							icon="archive"
							destructive
							onPress={() =>
								id &&
								archive.confirmArchive({ id, name: initialName }, () =>
									router.back(),
								)
							}
							busy={archive.pending}
						/>
					)}
				</SettingsSection>
			) : null}
		</Sheet>
	);
}
