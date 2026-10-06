import type { WebhookDelivery, WebhookEndpoint } from "@farmer/api-client";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import {
	useResendWebhookDelivery,
	useRollWebhookSecret,
	useSendWebhookTest,
	useUpdateWebhookEndpoint,
	useWebhookDeliveries,
	useWebhookEndpoint,
} from "../../../../src/api/workspace";
import {
	EmptyState,
	ErrorState,
	Skeleton,
	Text,
} from "../../../../src/ui/components";
import { Screen } from "../../../../src/ui/screen";
import {
	SettingsSection,
	SettingsValue,
} from "../../../../src/ui/settings-list";
import { usePalette } from "../../../../src/ui/theme";
import { SPACE } from "../../../../src/ui/type";
import {
	ActionRow,
	Badge,
	confirmAction,
	DetailRow,
	ListSkeleton,
	NoteRow,
	notify,
	notifyError,
} from "../../../../src/workspace/components";
import { formatInstant } from "../../../../src/workspace/format";
import { paramOf } from "../../../../src/workspace/params";
import { useConfirmDeleteEndpoint } from "../../../../src/workspace/webhooks/delete";
import {
	healthOf,
	type Status,
	WEBHOOK_EVENTS,
} from "../../../../src/workspace/webhooks/events";
import { SecretCard } from "../../../../src/workspace/webhooks/secret-card";

/** One endpoint: its status, its events, the actions on it and the log of
 *  every delivery attempt. */
export default function WebhookEndpointScreen() {
	const params = useLocalSearchParams();
	const id = paramOf(params.id) ?? "";
	const endpoint = useWebhookEndpoint(id);
	const deliveries = useWebhookDeliveries(id);
	const refreshing = endpoint.isRefetching || deliveries.isRefetching;
	const refresh = () => {
		void endpoint.refetch();
		void deliveries.refetch();
	};
	return (
		<Screen topInset={false} refreshing={refreshing} onRefresh={refresh}>
			<Stack.Screen options={{ title: "Webhook endpoint" }} />
			{endpoint.isPending ? (
				<View style={{ paddingHorizontal: SPACE.l, gap: SPACE.s }}>
					<Skeleton height={56} radius={16} />
					<ListSkeleton />
				</View>
			) : endpoint.error ? (
				<ErrorState error={endpoint.error} onRetry={refresh} />
			) : (
				<EndpointBody
					endpoint={endpoint.data}
					deliveries={deliveries.data}
					deliveriesPending={deliveries.isPending}
					deliveriesError={deliveries.error}
					onRetry={refresh}
				/>
			)}
		</Screen>
	);
}

function EndpointBody({
	endpoint,
	deliveries,
	deliveriesPending,
	deliveriesError,
	onRetry,
}: {
	endpoint: WebhookEndpoint;
	deliveries: WebhookDelivery[] | undefined;
	deliveriesPending: boolean;
	deliveriesError: Error | null;
	onRetry: () => void;
}) {
	const router = useRouter();
	const palette = usePalette();
	const update = useUpdateWebhookEndpoint();
	const test = useSendWebhookTest();
	const roll = useRollWebhookSecret();
	const remove = useConfirmDeleteEndpoint();
	// The rolled secret lives only in this state. The next screen or a
	// press on "Done" drops it.
	const [secret, setSecret] = useState<string | null>(null);
	const health = healthOf(endpoint);
	const off = endpoint.disabledAt !== null;
	const busy =
		update.isPending || test.isPending || roll.isPending || remove.pending;

	const rollSecret = () =>
		confirmAction({
			title: "Roll the secret?",
			message:
				"The old secret stays valid for 24 hours. Both are sent in the Farmer-Signature header until then.",
			action: "Roll secret",
			onConfirm: () =>
				roll.mutate(endpoint.id, {
					onSuccess: (result) => {
						setSecret(result.secret);
						roll.reset();
					},
					onError: (error) => notifyError("Could not roll the secret", error),
				}),
		});

	const setDisabled = (disabled: boolean) =>
		update.mutate(
			{ id: endpoint.id, body: { disabled } },
			{ onError: (error) => notifyError("Could not save", error) },
		);

	const toggleOff = () => {
		if (!off) {
			confirmAction({
				title: "Turn off this endpoint?",
				message: "No events are sent to it until you turn it on again.",
				action: "Turn off",
				onConfirm: () => setDisabled(true),
			});
			return;
		}
		setDisabled(false);
	};

	const deleteEndpoint = () => remove.confirm(endpoint, () => router.back());

	return (
		<View style={{ gap: SPACE.l }}>
			{secret !== null ? (
				<SecretCard
					secret={secret}
					note={
						endpoint.previousSecretExpiresAt
							? `The old secret still signs until ${formatInstant(endpoint.previousSecretExpiresAt)}.`
							: undefined
					}
					onDone={() => setSecret(null)}
				/>
			) : null}

			<SettingsSection title="Status">
				<DetailRow
					title={endpoint.url}
					subtitle={endpoint.description ?? undefined}
					trailing={<Badge label={health.label} tone={health.tone} />}
				/>
				{off ? (
					<SettingsValue
						title="Off since"
						value={formatInstant(endpoint.disabledAt ?? "")}
					/>
				) : null}
				{off && endpoint.disabledReason ? (
					<NoteRow>{endpoint.disabledReason}</NoteRow>
				) : null}
				{endpoint.failingSince ? (
					<SettingsValue
						title="Failing since"
						value={formatInstant(endpoint.failingSince)}
					/>
				) : null}
				<SettingsValue
					title="Last success"
					value={
						endpoint.lastSuccessAt
							? formatInstant(endpoint.lastSuccessAt)
							: "None yet"
					}
				/>
				<SettingsValue title="Secret ends in" value={endpoint.secretHint} />
				{endpoint.previousSecretExpiresAt ? (
					<SettingsValue
						title="Old secret signs until"
						value={formatInstant(endpoint.previousSecretExpiresAt)}
					/>
				) : null}
				<SettingsValue
					title="Added"
					value={`${formatInstant(endpoint.createdAt)}${endpoint.createdByName ? `, ${endpoint.createdByName}` : ""}`}
				/>
			</SettingsSection>

			<SettingsSection title="Actions">
				<ActionRow
					label="Send test event"
					icon="send"
					disabled={off || busy}
					busy={test.isPending}
					onPress={() =>
						test.mutate(endpoint.id, {
							onSuccess: () => notify("Test event queued"),
							onError: (error) => notifyError("Could not send a test", error),
						})
					}
				/>
				<ActionRow
					label="Edit"
					disabled={busy}
					onPress={() =>
						router.push({
							pathname: "/workspace/webhooks/[id]/edit",
							params: { id: endpoint.id },
						})
					}
				/>
				<ActionRow
					label="Roll secret"
					icon="refresh"
					disabled={busy}
					busy={roll.isPending}
					onPress={rollSecret}
				/>
				<ActionRow
					label={off ? "Turn on" : "Turn off"}
					disabled={busy}
					busy={update.isPending}
					onPress={toggleOff}
				/>
				<ActionRow
					label="Delete"
					destructive
					disabled={busy}
					busy={remove.pending}
					onPress={deleteEndpoint}
				/>
			</SettingsSection>

			<SettingsSection
				title="Events"
				footer="These events will be sent to the webhook."
			>
				{endpoint.enabledEvents.map((kind) => (
					<DetailRow
						key={kind}
						title={kind}
						subtitle={
							WEBHOOK_EVENTS.find((event) => event.value === kind)?.description
						}
					/>
				))}
			</SettingsSection>

			<View style={{ gap: SPACE.xs }}>
				<View style={{ paddingHorizontal: SPACE.xl }}>
					<Text variant="titleSmall" color={palette.primary}>
						Deliveries
					</Text>
				</View>
				{deliveriesPending ? (
					<ListSkeleton rows={3} />
				) : deliveriesError ? (
					<ErrorState error={deliveriesError} onRetry={onRetry} />
				) : !deliveries || deliveries.length === 0 ? (
					<EmptyState icon="inbox" title="No attempts yet" />
				) : (
					<DeliveryList deliveries={deliveries} />
				)}
			</View>
		</View>
	);
}

/** A delivery's verdict, in the words of the web app. */
const outcomeOf = (delivery: WebhookDelivery): Status => {
	if (!delivery.attemptedAt) return { label: "Queued", tone: "accent" };
	if (!delivery.error) {
		return { label: String(delivery.statusCode ?? 200), tone: "success" };
	}
	return {
		label:
			delivery.statusCode === null ? "No reply" : String(delivery.statusCode),
		tone: "error",
	};
};

function DeliveryList({ deliveries }: { deliveries: WebhookDelivery[] }) {
	const resend = useResendWebhookDelivery();
	const [open, setOpen] = useState<readonly string[]>([]);
	const toggle = (id: string) =>
		setOpen((current) =>
			current.includes(id)
				? current.filter((value) => value !== id)
				: [...current, id],
		);
	return (
		<SettingsSection footer="Webhook delivery attempts, history kept for 14 days.">
			{deliveries.flatMap((delivery) => {
				const outcome = outcomeOf(delivery);
				const expanded = open.includes(delivery.id);
				const detail = delivery.error ?? delivery.responseSample;
				const lines = [
					formatInstant(delivery.attemptedAt ?? delivery.createdAt),
					`Try ${delivery.attempt}${delivery.manual ? ", by hand" : ""}${delivery.durationMs === null ? "" : `, ${delivery.durationMs} ms`}`,
					delivery.nextAttemptAt
						? `Next try ${formatInstant(delivery.nextAttemptAt)}`
						: "",
				].filter(Boolean);
				const rows = [
					<DetailRow
						key={delivery.id}
						title={delivery.kind}
						subtitle={lines.join("\n")}
						accessibilityLabel={`${delivery.kind}, ${outcome.label}, ${expanded ? "hide" : "show"} details`}
						trailing={
							<View style={{ alignItems: "flex-end", gap: SPACE.xs }}>
								<Badge label={outcome.label} tone={outcome.tone} />
								{delivery.manual ? <Badge label="By hand" /> : null}
							</View>
						}
						onPress={() => toggle(delivery.id)}
					/>,
				];
				if (expanded) {
					rows.push(
						<NoteRow key={`${delivery.id}-detail`}>
							{detail ?? "The receiver sent no text."}
						</NoteRow>,
					);
				}
				if (expanded && delivery.canResend) {
					rows.push(
						<ActionRow
							key={`${delivery.id}-resend`}
							label="Resend"
							icon="send"
							busy={resend.isPending && resend.variables === delivery.id}
							disabled={resend.isPending}
							onPress={() =>
								resend.mutate(delivery.id, {
									onSuccess: () => notify("Queued for another attempt"),
									onError: (error) => notifyError("Could not resend", error),
								})
							}
						/>,
					);
				}
				return rows;
			})}
		</SettingsSection>
	);
}
