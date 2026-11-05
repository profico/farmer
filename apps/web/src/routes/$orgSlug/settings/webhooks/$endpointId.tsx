import { WEBHOOK_EVENT_KINDS } from "@farmer/core/api";
import {
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { SettingsEyebrow } from "#/components/settings-nav.tsx";
import { StatusPill } from "#/components/status-pill.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog.tsx";
import { Page, PageHeader, PageSection } from "#/components/ui/page-header.tsx";
import { PillToggleGroup } from "#/components/ui/pill-toggle-group.tsx";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { WEBHOOKS_ITEM } from "#/lib/nav-items.ts";
import { queryKeys } from "#/queries/keys.ts";
import {
	webhookDeliveriesQuery,
	webhookEndpointQuery,
} from "#/queries/webhooks.ts";
import {
	deleteWebhookEndpoint,
	resendWebhookDelivery,
	rollWebhookSecret,
	sendWebhookTestEvent,
	updateWebhookEndpoint,
} from "#/server/webhooks.ts";

// One endpoint: what it is subscribed to, the four things you can do to it, and
// every attempt Farmer has made at it in the last fortnight.
//
// The log refetches on a ten-second interval (`webhookDeliveriesQuery`) because
// the delivery job ticks every minute and the reason anybody opens this page is
// to watch what happened to the test they just sent.

export const Route = createFileRoute("/$orgSlug/settings/webhooks/$endpointId")(
	{
		loader: async ({ context, params }) => {
			await Promise.all([
				context.queryClient.ensureQueryData(
					webhookEndpointQuery(params.orgSlug, params.endpointId),
				),
				context.queryClient.ensureQueryData(
					webhookDeliveriesQuery(params.orgSlug, params.endpointId),
				),
			]);
		},
		component: WebhookEndpointPage,
	},
);

const KIND_ITEMS = WEBHOOK_EVENT_KINDS.map((kind) => ({
	id: kind,
	label: kind,
}));

const formatWhen = (value: Date | null) =>
	value
		? new Date(value).toLocaleString(undefined, {
				dateStyle: "medium",
				timeStyle: "short",
			})
		: "—";

/** A delivery's verdict, in the three words a pill has room for. */
const outcomeOf = (delivery: {
	attemptedAt: Date | null;
	statusCode: number | null;
	error: string | null;
}) => {
	if (!delivery.attemptedAt)
		return { tone: "warning" as const, label: "Queued" };
	if (!delivery.error) {
		return {
			tone: "positive" as const,
			label: String(delivery.statusCode ?? 200),
		};
	}
	// A request that never got a status — DNS, TLS, a timeout, an address the
	// guard refused — has no number to show, so it says what it was instead.
	return {
		tone: "negative" as const,
		label:
			delivery.statusCode === null ? "No reply" : String(delivery.statusCode),
	};
};

function WebhookEndpointPage() {
	const orgSlug = useOrgSlug();
	const { endpointId } = Route.useParams();
	const navigate = useNavigate();
	const queryClient = useQueryClient();

	const { data: endpoint } = useSuspenseQuery(
		webhookEndpointQuery(orgSlug, endpointId),
	);
	const { data: deliveries } = useSuspenseQuery(
		webhookDeliveriesQuery(orgSlug, endpointId),
	);
	const [rolledSecret, setRolledSecret] = useState<string | null>(null);

	const refresh = () =>
		queryClient.invalidateQueries({
			queryKey: [...queryKeys(orgSlug).webhooks],
		});

	const update = useMutation({
		mutationFn: updateWebhookEndpoint,
		onSuccess: refresh,
		onError: (error) => toast.error(error.message ?? "Could not save"),
	});

	const test = useMutation({
		mutationFn: () => sendWebhookTestEvent({ data: endpointId }),
		onSuccess: async () => {
			await refresh();
			// Queued, not delivered: the job sends it within the minute, and the
			// log below is what says whether it arrived. Promising more than that
			// would be a lie about where the work happens.
			toast.success("Test event queued");
		},
		onError: (error) => toast.error(error.message ?? "Could not send a test"),
	});

	const roll = useMutation({
		mutationFn: () => rollWebhookSecret({ data: endpointId }),
		onSuccess: async (result) => {
			await refresh();
			setRolledSecret(result.secret);
		},
		onError: (error) =>
			toast.error(error.message ?? "Could not roll the secret"),
	});

	const remove = useMutation({
		mutationFn: () => deleteWebhookEndpoint({ data: endpointId }),
		onSuccess: async () => {
			await refresh();
			await navigate({
				to: "/$orgSlug/settings/webhooks",
				params: { orgSlug },
			});
		},
		onError: (error) => toast.error(error.message ?? "Could not delete"),
	});

	const resend = useMutation({
		mutationFn: (deliveryId: string) =>
			resendWebhookDelivery({ data: { deliveryId } }),
		onSuccess: async () => {
			await refresh();
			toast.success("Queued for another attempt");
		},
		onError: (error) => toast.error(error.message ?? "Could not resend"),
	});

	return (
		<Page>
			<PageHeader
				eyebrow={<SettingsEyebrow back={WEBHOOKS_ITEM} />}
				// A receiver's URL is long and has no spaces in it, so the serif
				// title breaks inside the string rather than reaching past the
				// island's edge.
				title={<span className="break-all">{endpoint.url}</span>}
				lede={
					<>
						{endpoint.description ? `${endpoint.description}. ` : ""}
						{endpoint.disabledAt ? (
							<>
								Off
								{endpoint.disabledReason
									? ` — ${endpoint.disabledReason.toLowerCase()}`
									: ""}
								. No events are sent.
							</>
						) : (
							<>
								Secret ends in{" "}
								<code className="font-mono">{endpoint.secretHint}</code>. Added{" "}
								{formatWhen(endpoint.createdAt)}
								{endpoint.createdByName ? ` by ${endpoint.createdByName}` : ""}.
							</>
						)}
					</>
				}
				action={
					<div className="flex flex-wrap items-center gap-2">
						<Button
							variant="outline"
							disabled={test.isPending || endpoint.disabledAt !== null}
							onClick={() => test.mutate()}
						>
							Send test event
						</Button>
						<Button
							variant="outline"
							disabled={roll.isPending}
							onClick={() => roll.mutate()}
						>
							Roll secret
						</Button>
						<Button
							variant="outline"
							disabled={update.isPending}
							onClick={() =>
								update.mutate({
									data: {
										endpointId,
										disabled: endpoint.disabledAt === null,
									},
								})
							}
						>
							{endpoint.disabledAt ? "Turn on" : "Turn off"}
						</Button>
						<Button
							variant="destructive"
							disabled={remove.isPending}
							onClick={() => remove.mutate()}
						>
							Delete
						</Button>
					</div>
				}
			/>

			<PageSection title="Events">
				<PillToggleGroup
					items={KIND_ITEMS}
					selectedIds={endpoint.enabledEvents}
					disabled={update.isPending}
					onToggle={(id) => {
						const chosen = new Set<string>(endpoint.enabledEvents);
						if (chosen.has(id)) chosen.delete(id);
						else chosen.add(id);
						const next = WEBHOOK_EVENT_KINDS.filter((kind) => chosen.has(kind));
						// The database refuses an empty list, so the UI says why rather
						// than sending a write it knows will fail.
						if (next.length === 0) {
							toast.error("Pick at least one event");
							return;
						}
						update.mutate({ data: { endpointId, enabledEvents: next } });
					}}
				/>
			</PageSection>

			<PageSection title="Deliveries" description="Kept for 14 days.">
				{deliveries.length === 0 ? (
					<p className="text-sm text-muted-foreground">No attempts yet.</p>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>When</TableHead>
								<TableHead>Event</TableHead>
								<TableHead className="text-right">Try</TableHead>
								<TableHead>Result</TableHead>
								<TableHead>Detail</TableHead>
								<TableHead />
							</TableRow>
						</TableHeader>
						<TableBody>
							{deliveries.map((delivery) => {
								const outcome = outcomeOf(delivery);
								return (
									<TableRow key={delivery.id}>
										<TableCell className="tnum text-muted-foreground">
											{formatWhen(delivery.attemptedAt ?? delivery.createdAt)}
										</TableCell>
										<TableCell className="font-mono text-xs">
											{delivery.kind}
										</TableCell>
										<TableCell className="tnum text-right text-muted-foreground">
											{delivery.attempt}
											{delivery.manual && " · by hand"}
										</TableCell>
										<TableCell>
											<StatusPill tone={outcome.tone}>
												{outcome.label}
											</StatusPill>
										</TableCell>
										{/* A receiver's reply is arbitrary text — webhook.site
										    answers with a paragraph of HTML — so the column is
										    capped and the full string stays in the title. A cell
										    that grows to fit it makes the whole table scroll
										    sideways and hides the Resend button. */}
										<TableCell
											className="max-w-[40ch] truncate text-xs text-muted-foreground"
											title={delivery.error ?? delivery.responseSample ?? ""}
										>
											{delivery.error ??
												delivery.responseSample ??
												(delivery.nextAttemptAt
													? `Next try ${formatWhen(delivery.nextAttemptAt)}`
													: "—")}
										</TableCell>
										<TableCell className="text-right">
											<Button
												variant="ghost"
												size="sm"
												disabled={!delivery.canResend || resend.isPending}
												onClick={() => resend.mutate(delivery.id)}
											>
												Resend
											</Button>
										</TableCell>
									</TableRow>
								);
							})}
						</TableBody>
					</Table>
				)}
			</PageSection>

			{/* The roll's reveal. Same rule as creation: shown once, and the only
			    way out of the dialog is the button that says it has been saved. */}
			<Dialog
				open={rolledSecret !== null}
				onOpenChange={(next) => {
					if (!next) setRolledSecret(null);
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Copy the new secret</DialogTitle>
					</DialogHeader>
					<div className="grid gap-3">
						<p className="text-sm text-muted-foreground">
							The old secret stays valid for 24 hours. Both are sent in the{" "}
							<code className="font-mono">Farmer-Signature</code> header until
							then.
						</p>
						<code className="block rounded-md bg-muted p-3 font-mono text-xs break-all select-all">
							{rolledSecret}
						</code>
					</div>
					<DialogFooter>
						<Button onClick={() => setRolledSecret(null)}>
							I have saved it
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</Page>
	);
}
