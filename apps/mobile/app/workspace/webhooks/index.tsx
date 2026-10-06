import { Stack, useRouter } from "expo-router";

import { useWebhookEndpoints } from "../../../src/api/workspace";
import { EmptyState, ErrorState, IconButton } from "../../../src/ui/components";
import { Screen } from "../../../src/ui/screen";
import { SettingsSection } from "../../../src/ui/settings-list";
import {
	Badge,
	DetailRow,
	ListSkeleton,
} from "../../../src/workspace/components";
import { formatInstant } from "../../../src/workspace/format";
import { useConfirmDeleteEndpoint } from "../../../src/workspace/webhooks/delete";
import { healthOf } from "../../../src/workspace/webhooks/events";

/** The webhook endpoints of the workspace, with how each one is doing. */
export default function WebhooksScreen() {
	const router = useRouter();
	const endpoints = useWebhookEndpoints();
	const remove = useConfirmDeleteEndpoint();
	const rows = endpoints.data ?? [];
	return (
		<Screen
			topInset={false}
			refreshing={endpoints.isRefetching}
			onRefresh={() => void endpoints.refetch()}
		>
			<Stack.Screen
				options={{
					title: "Webhooks",
					headerRight: () => (
						<IconButton
							icon="add"
							label="Add a webhook endpoint"
							onPress={() => router.push("/workspace/webhooks/new")}
						/>
					),
				}}
			/>
			{endpoints.isPending ? (
				<ListSkeleton />
			) : endpoints.error ? (
				<ErrorState
					error={endpoints.error}
					onRetry={() => void endpoints.refetch()}
				/>
			) : rows.length === 0 ? (
				<EmptyState
					icon="webhook"
					title="No endpoints yet"
					message="Add one to start sending events."
				/>
			) : (
				<SettingsSection footer="One signed POST per event, with a delivery log. Events can arrive out of order, so dedupe on the event id.">
					{rows.map((endpoint) => {
						const health = healthOf(endpoint);
						const open = () =>
							router.push({
								pathname: "/workspace/webhooks/[id]",
								params: { id: endpoint.id },
							});
						return (
							<DetailRow
								key={endpoint.id}
								title={endpoint.url}
								subtitle={[
									endpoint.description,
									`${endpoint.enabledEvents.length} ${endpoint.enabledEvents.length === 1 ? "event" : "events"}`,
									endpoint.lastSuccessAt
										? `Last success ${formatInstant(endpoint.lastSuccessAt)}`
										: "No success yet",
								]
									.filter(Boolean)
									.join("\n")}
								trailing={<Badge label={health.label} tone={health.tone} />}
								onPress={open}
								actions={[
									{ label: "Edit", icon: "edit", onPress: open },
									{
										label: "Delete",
										icon: "delete",
										destructive: true,
										onPress: () => remove.confirm(endpoint),
									},
								]}
							/>
						);
					})}
				</SettingsSection>
			)}
		</Screen>
	);
}
