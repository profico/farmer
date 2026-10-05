import type { WebhookEndpoint } from "@farmer/api-client";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import {
	useUpdateWebhookEndpoint,
	useWebhookEndpoint,
} from "../../../../src/api/workspace";
import { FormSection, Sheet } from "../../../../src/forms/sheet";
import {
	EmptyState,
	ErrorBanner,
	Field,
	Skeleton,
} from "../../../../src/ui/components";
import { messageOf } from "../../../../src/ui/errors";
import { SPACE } from "../../../../src/ui/type";
import { paramOf } from "../../../../src/workspace/params";
import { EventPicker } from "../../../../src/workspace/webhooks/event-picker";
import {
	urlProblemOf,
	WEBHOOK_EVENTS,
	type WebhookEventKind,
} from "../../../../src/workspace/webhooks/events";

/** Changes the URL, the description and the events of an endpoint. */
export default function EditWebhookSheet() {
	const params = useLocalSearchParams();
	const id = paramOf(params.id) ?? "";
	const endpoint = useWebhookEndpoint(id);
	if (endpoint.isPending) {
		return (
			<Sheet
				title="Edit endpoint"
				actionLabel="Save"
				onAction={() => undefined}
				busy
			>
				<Skeleton height={56} radius={16} />
				<Skeleton height={56} radius={16} />
			</Sheet>
		);
	}
	if (!endpoint.data) {
		return (
			<Sheet
				title="Edit endpoint"
				actionLabel="Save"
				onAction={() => undefined}
				actionDisabled
			>
				<EmptyState
					icon="error"
					title="This endpoint cannot be read"
					message={messageOf(endpoint.error) ?? "It may be deleted."}
				/>
			</Sheet>
		);
	}
	return <EditForm endpoint={endpoint.data} />;
}

/** The kinds of the endpoint that the catalogue knows, in catalogue order. */
const knownKinds = (kinds: readonly string[]): WebhookEventKind[] =>
	WEBHOOK_EVENTS.map((event) => event.value).filter((value) =>
		kinds.includes(value),
	);

function EditForm({ endpoint }: { endpoint: WebhookEndpoint }) {
	const router = useRouter();
	const update = useUpdateWebhookEndpoint();
	const [url, setUrl] = useState(endpoint.url);
	const [description, setDescription] = useState(endpoint.description ?? "");
	const [events, setEvents] = useState(knownKinds(endpoint.enabledEvents));
	const [touched, setTouched] = useState(false);
	const failure = messageOf(update.error);
	const problem = urlProblemOf(url);
	const noEvents = events.length === 0;

	const save = () => {
		setTouched(true);
		if (problem !== null || noEvents) return;
		update.mutate(
			{
				id: endpoint.id,
				body: {
					url: url.trim(),
					description: description.trim(),
					enabledEvents: events,
				},
			},
			{ onSuccess: () => router.back() },
		);
	};

	return (
		<Sheet
			title="Edit endpoint"
			actionLabel="Save"
			onAction={save}
			busy={update.isPending}
		>
			{failure ? <ErrorBanner message={failure} /> : null}
			<FormSection label="Endpoint">
				<Field
					label="URL"
					value={url}
					onChangeText={setUrl}
					keyboardType="url"
					autoCapitalize="none"
					autoCorrect={false}
					error={touched ? problem : null}
				/>
				<Field
					label="Description"
					value={description}
					onChangeText={setDescription}
					placeholder="What is this endpoint for?"
					maxLength={200}
				/>
			</FormSection>
			<FormSection label="Events">
				<View style={{ marginHorizontal: -SPACE.l }}>
					<EventPicker chosen={events} onChange={setEvents} />
				</View>
				{touched && noEvents ? (
					<ErrorBanner message="Pick at least one event" />
				) : null}
			</FormSection>
		</Sheet>
	);
}
