import { WEBHOOK_EVENT_KINDS } from "@farmer/core/api";
import { createWebhookEndpointInput } from "@farmer/core/schema";
import { zodResolver } from "@hookform/resolvers/zod";
import {
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { SettingsEyebrow } from "#/components/settings-nav.tsx";
import { StatusPill } from "#/components/status-pill.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "#/components/ui/dialog.tsx";
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "#/components/ui/form.tsx";
import { InputGroup, InputGroupInput } from "#/components/ui/input-group.tsx";
import { Page, PageHeader } from "#/components/ui/page-header.tsx";
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
import { queryKeys } from "#/queries/keys.ts";
import { webhookEndpointsQuery } from "#/queries/webhooks.ts";
import { createWebhookEndpoint } from "#/server/webhooks.ts";

// Settings → Webhooks: the endpoint list and the one dialog that registers one.
// The delivery log, the secret roll and the test button live on the endpoint's
// own page — this screen answers "what are we sending, and to whom", which is
// the question an admin opens it with.

export const Route = createFileRoute("/$orgSlug/settings/webhooks/")({
	loader: async ({ context, params }) => {
		await context.queryClient.ensureQueryData(
			webhookEndpointsQuery(params.orgSlug),
		);
	},
	component: WebhooksSettingsPage,
});

/** The event kinds as pills, in the order `api/webhooks.ts` lists them. */
const KIND_ITEMS = WEBHOOK_EVENT_KINDS.map((kind) => ({
	id: kind,
	label: kind,
}));

type CreateInput = z.infer<typeof createWebhookEndpointInput>;

/** How an endpoint is doing, in the three words a pill has room for. */
const healthOf = (endpoint: {
	disabledAt: Date | null;
	failingSince: Date | null;
	lastSuccessAt: Date | null;
}) => {
	if (endpoint.disabledAt) return { tone: "neutral" as const, label: "Off" };
	if (endpoint.failingSince)
		return { tone: "negative" as const, label: "Failing" };
	if (endpoint.lastSuccessAt) {
		return { tone: "positive" as const, label: "Delivering" };
	}
	return { tone: "warning" as const, label: "Untested" };
};

const formatWhen = (value: Date | null) =>
	value
		? new Date(value).toLocaleString(undefined, {
				dateStyle: "medium",
				timeStyle: "short",
			})
		: "—";

function WebhooksSettingsPage() {
	const orgSlug = useOrgSlug();
	const { data: endpoints } = useSuspenseQuery(webhookEndpointsQuery(orgSlug));

	return (
		<Page>
			<PageHeader
				eyebrow={<SettingsEyebrow />}
				title="Webhooks"
				lede={
					<>
						One signed POST per event, with a delivery log. Events can arrive
						out of order, so dedupe on the event id.
					</>
				}
				action={<CreateEndpointDialog />}
			/>

			{endpoints.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					No endpoints yet. Add one to start sending events.
				</p>
			) : (
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>URL</TableHead>
							<TableHead className="text-right">Events</TableHead>
							<TableHead>Status</TableHead>
							<TableHead>Last success</TableHead>
							<TableHead />
						</TableRow>
					</TableHeader>
					<TableBody>
						{endpoints.map((endpoint) => {
							const health = healthOf(endpoint);
							return (
								<TableRow key={endpoint.id}>
									{/* The URL is the row's name and a receiver's is routinely
									    60 characters of opaque id, so it wraps inside a capped
									    column rather than pushing the four short columns
									    beside it off the side of the table. */}
									<TableCell className="max-w-[46ch] py-3 font-medium whitespace-normal">
										<span className="block break-all font-mono text-xs">
											{endpoint.url}
										</span>
										{endpoint.description && (
											<span className="mt-1 block text-xs text-muted-foreground">
												{endpoint.description}
											</span>
										)}
									</TableCell>
									<TableCell className="tnum text-right text-muted-foreground">
										{endpoint.enabledEvents.length}
									</TableCell>
									<TableCell>
										<StatusPill tone={health.tone}>{health.label}</StatusPill>
									</TableCell>
									<TableCell className="tnum text-muted-foreground">
										{formatWhen(endpoint.lastSuccessAt)}
									</TableCell>
									<TableCell className="text-right">
										<Button
											variant="outline"
											size="sm"
											nativeButton={false}
											render={
												<Link
													to="/$orgSlug/settings/webhooks/$endpointId"
													params={{ orgSlug, endpointId: endpoint.id }}
												>
													Open
												</Link>
											}
										/>
									</TableCell>
								</TableRow>
							);
						})}
					</TableBody>
				</Table>
			)}
		</Page>
	);
}

/**
 * Register an endpoint, then show its secret — once.
 *
 * Two stages in one dialog rather than a toast, because the secret is never
 * readable again and a toast is dismissible by accident. The reveal stage has
 * no Cancel: the only way out is the button that says it has been copied.
 */
function CreateEndpointDialog() {
	const orgSlug = useOrgSlug();
	const [open, setOpen] = useState(false);
	const [secret, setSecret] = useState<string | null>(null);
	const queryClient = useQueryClient();

	const form = useForm<CreateInput>({
		resolver: zodResolver(createWebhookEndpointInput),
		defaultValues: { url: "", description: "", enabledEvents: [] },
	});

	const mutation = useMutation({
		mutationFn: (data: CreateInput) => createWebhookEndpoint({ data }),
		onSuccess: async (result) => {
			await queryClient.invalidateQueries({
				queryKey: [...queryKeys(orgSlug).webhooks],
			});
			setSecret(result.secret);
			form.reset({ url: "", description: "", enabledEvents: [] });
		},
		// The URL rules answer with the actual reason ("resolves to 127.0.0.1,
		// which is not reachable from the public internet"), so show it rather
		// than a generic failure.
		onError: (error) =>
			toast.error(error.message ?? "Could not add the endpoint"),
	});

	const close = () => {
		setOpen(false);
		setSecret(null);
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (next) {
					setSecret(null);
					form.reset({ url: "", description: "", enabledEvents: [] });
				}
				setOpen(next);
			}}
		>
			<DialogTrigger render={<Button>+ New endpoint</Button>} />
			<DialogContent>
				{secret ? (
					<>
						<DialogHeader>
							<DialogTitle>Copy the secret</DialogTitle>
						</DialogHeader>
						<div className="grid gap-3">
							<p className="text-sm text-muted-foreground">
								Shown once. Use it to verify the{" "}
								<code className="font-mono">Farmer-Signature</code> header. If
								you lose it, roll the secret — the old one stays valid for 24
								hours.
							</p>
							<code className="block rounded-md bg-muted p-3 font-mono text-xs break-all select-all">
								{secret}
							</code>
						</div>
						<DialogFooter>
							<Button
								variant="outline"
								onClick={() => {
									void copySecret(secret);
								}}
							>
								Copy
							</Button>
							<Button onClick={close}>I have saved it</Button>
						</DialogFooter>
					</>
				) : (
					<>
						<DialogHeader>
							<DialogTitle>New webhook endpoint</DialogTitle>
						</DialogHeader>
						<Form {...form}>
							<form
								onSubmit={form.handleSubmit((data) => mutation.mutate(data))}
								className="grid grid-cols-[minmax(0,1fr)] gap-4"
							>
								<FormField
									control={form.control}
									name="url"
									render={({ field }) => (
										<FormItem>
											<FormLabel required>URL</FormLabel>
											<InputGroup>
												<FormControl>
													<InputGroupInput
														autoFocus
														placeholder="https://example.com/farmer-webhook"
														{...field}
													/>
												</FormControl>
												<FormMessage />
											</InputGroup>
										</FormItem>
									)}
								/>
								<FormField
									control={form.control}
									name="description"
									render={({ field }) => (
										<FormItem>
											<FormLabel>Description</FormLabel>
											<InputGroup>
												<FormControl>
													<InputGroupInput
														placeholder="What is this endpoint for?"
														{...field}
														value={field.value ?? ""}
													/>
												</FormControl>
												<FormMessage />
											</InputGroup>
										</FormItem>
									)}
								/>
								<FormField
									control={form.control}
									name="enabledEvents"
									render={({ field }) => (
										<FormItem>
											<FormLabel required>Events</FormLabel>
											<PillToggleGroup
												items={KIND_ITEMS}
												selectedIds={field.value}
												onToggle={(id) => {
													const chosen = new Set<string>(field.value);
													if (chosen.has(id)) chosen.delete(id);
													else chosen.add(id);
													// Kept in the catalogue's order rather than in the
													// order they were clicked, so two endpoints with the
													// same events read the same on screen.
													field.onChange(
														WEBHOOK_EVENT_KINDS.filter((kind) =>
															chosen.has(kind),
														),
													);
												}}
											/>
											<FormMessage />
										</FormItem>
									)}
								/>
								<DialogFooter>
									<Button type="submit" disabled={mutation.isPending}>
										Add endpoint
									</Button>
								</DialogFooter>
							</form>
						</Form>
					</>
				)}
			</DialogContent>
		</Dialog>
	);
}

/** Copy the secret, and say whether it worked — the same rule as the MCP URL
 *  on the Integrations page: a button that silently does nothing is worse than
 *  one that admits it, since the string is on screen to select. */
const copySecret = async (secret: string) => {
	try {
		await navigator.clipboard.writeText(secret);
		toast.success("Secret copied");
	} catch {
		toast.error("Could not copy — select the text instead");
	}
};
