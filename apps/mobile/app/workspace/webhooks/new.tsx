import { useRouter } from "expo-router";
import { useState } from "react";
import { Platform, View } from "react-native";

import { useCreateWebhookEndpoint } from "../../../src/api/workspace";
import {
	FormCluster,
	FormPart,
	FormSection,
	Sheet,
} from "../../../src/forms/sheet";
import { ErrorBanner, Field } from "../../../src/ui/components";
import { messageOf } from "../../../src/ui/errors";
import { SPACE } from "../../../src/ui/type";
import { EventPicker } from "../../../src/workspace/webhooks/event-picker";
import {
	urlProblemOf,
	type WebhookEventKind,
} from "../../../src/workspace/webhooks/events";
import { SecretCard } from "../../../src/workspace/webhooks/secret-card";

/**
 * Registers an endpoint, then shows its signing secret one time. The secret
 * stays in this component's state. The mutation result is reset at once, so
 * the secret does not stay in the mutation cache.
 */
export default function NewWebhookSheet() {
	const router = useRouter();
	const create = useCreateWebhookEndpoint();
	const [url, setUrl] = useState("");
	const [description, setDescription] = useState("");
	const [events, setEvents] = useState<WebhookEventKind[]>([]);
	const [secret, setSecret] = useState<string | null>(null);
	const [touched, setTouched] = useState(false);

	if (secret !== null) {
		return (
			<Sheet
				title="Signing secret"
				actionLabel="Done"
				onAction={() => router.back()}
			>
				<View style={{ marginHorizontal: -SPACE.l }}>
					<SecretCard secret={secret} onDone={() => router.back()} />
				</View>
			</Sheet>
		);
	}

	const failure = messageOf(create.error);
	const problem = urlProblemOf(url);
	const noEvents = events.length === 0;
	const save = () => {
		setTouched(true);
		if (problem !== null || noEvents) return;
		create.mutate(
			{
				url: url.trim(),
				description: description.trim() === "" ? undefined : description.trim(),
				enabledEvents: events,
			},
			{
				onSuccess: (result) => {
					setSecret(result.secret);
					create.reset();
				},
			},
		);
	};

	return (
		<Sheet
			// A short title and action fit between Cancel and the action on iOS.
			title={Platform.OS === "ios" ? "New webhook" : "New webhook endpoint"}
			actionLabel={Platform.OS === "ios" ? "Add" : "Add endpoint"}
			onAction={save}
			busy={create.isPending}
		>
			{failure ? <ErrorBanner message={failure} /> : null}
			<FormCluster>
				<FormPart
					footerError={touched && problem !== null}
					groupFooter={touched ? (problem ?? undefined) : undefined}
				>
					<Field
						label="URL"
						value={url}
						onChangeText={setUrl}
						placeholder="https://example.com/farmer-webhook"
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
				</FormPart>
			</FormCluster>
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
