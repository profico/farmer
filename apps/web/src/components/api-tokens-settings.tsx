import { createApiTokenInput } from "@farmer/core/schema";
import { zodResolver } from "@hookform/resolvers/zod";
import { KeyIcon } from "@phosphor-icons/react";
import {
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "#/components/ui/alert-dialog.tsx";
import { Badge } from "#/components/ui/badge.tsx";
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
	FormDescription,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "#/components/ui/form.tsx";
import { InputGroup, InputGroupInput } from "#/components/ui/input-group.tsx";
import {
	PageSection,
	SettingList,
	SettingRow,
} from "#/components/ui/page-header.tsx";
import {
	SegmentedControl,
	SegmentedControlItem,
} from "#/components/ui/segmented-control.tsx";
import { When } from "#/components/when.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { myApiTokensQuery } from "#/queries/api-tokens.ts";
import {
	createApiToken,
	type listMyApiTokens,
	revokeApiToken,
} from "#/server/api-tokens.ts";

/**
 * Preferences → API tokens: the credential for a script, beside the devices
 * the CLI signed in. See `docs/domains/api-tokens.md`.
 *
 * Rendered only while the CLI is switched on, because the same switch turns
 * the REST API off and a token for an API that answers 404 is no use.
 */

type ApiTokenRow = Awaited<ReturnType<typeof listMyApiTokens>>[number];
type CreateInput = z.infer<typeof createApiTokenInput>;

const DEFAULTS: CreateInput = {
	name: "",
	scope: "read",
	workspace: "this",
	expiresInDays: 90,
};

const SCOPES = [
	{ value: "read", label: "Read only" },
	{ value: "write", label: "Read and write" },
] as const;

const WORKSPACES = [
	{ value: "this", label: "Only this workspace" },
	{ value: "all", label: "All my workspaces" },
] as const;

const LIFETIMES = [
	{ value: 30, label: "30 days" },
	{ value: 90, label: "90 days" },
	{ value: 365, label: "1 year" },
	{ value: null, label: "Never" },
] as const;

export function ApiTokensSection() {
	const orgSlug = useOrgSlug();
	const { data: tokens } = useSuspenseQuery(myApiTokensQuery(orgSlug));

	return (
		<PageSection
			// The API reference links here as `/:org/settings/preferences#api-tokens`
			// (lib/openapi.ts), which opens the reader's own workspace.
			id="api-tokens"
			title="API tokens"
			description="For a script or a scheduled job that calls the Farmer API. A token acts as you, so it sees what you see. Tokens belong to your account, and the list is the same in every workspace."
			action={<CreateApiTokenDialog />}
		>
			{tokens.length === 0 ? (
				<p className="text-sm text-muted-foreground">You have no API tokens.</p>
			) : (
				<SettingList>
					{tokens.map((token) => (
						<ApiTokenRowView key={token.id} token={token} />
					))}
				</SettingList>
			)}
		</PageSection>
	);
}

function ApiTokenRowView({ token }: { token: ApiTokenRow }) {
	const orgSlug = useOrgSlug();
	const queryClient = useQueryClient();
	const [open, setOpen] = useState(false);

	const revoke = useMutation({
		mutationFn: () => revokeApiToken({ data: token.id }),
		onSuccess: async ({ revoked }) => {
			await queryClient.invalidateQueries({
				queryKey: myApiTokensQuery(orgSlug).queryKey,
			});
			// `false` is a token revoked in another tab between loading this list
			// and the click. The list is refreshed either way, so the row goes.
			toast.success(
				revoked ? `Revoked ${token.name}` : "That token was already revoked",
			);
		},
		onError: (error) =>
			toast.error(error.message ?? "Could not revoke that token"),
	});

	return (
		<SettingRow
			icon={<KeyIcon className="size-5 text-muted-foreground" />}
			title={token.name}
			badge={
				<>
					<Badge variant="secondary">
						{token.scope === "write" ? "Read and write" : "Read only"}
					</Badge>
					{token.expired ? <Badge variant="destructive">Expired</Badge> : null}
				</>
			}
			description={
				<>
					<span className="font-mono">…{token.hint}</span> ·{" "}
					{token.organization ? token.organization.name : "All workspaces"}.
					Made <When date={token.createdAt} />.{" "}
					{token.lastUsedAt ? (
						<>
							Last used <When date={token.lastUsedAt} />.
						</>
					) : (
						"Never used."
					)}{" "}
					{token.expiresAt ? (
						<>
							{token.expired ? "Expired" : "Expires"}{" "}
							<When date={token.expiresAt} />.
						</>
					) : (
						"Never expires."
					)}
				</>
			}
			action={
				<AlertDialog open={open} onOpenChange={setOpen}>
					<AlertDialogTrigger
						render={
							<Button
								variant="outline"
								className="hover:text-destructive"
								disabled={revoke.isPending}
							>
								{revoke.isPending ? "Revoking…" : "Revoke"}
							</Button>
						}
					/>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>Revoke {token.name}?</AlertDialogTitle>
							<AlertDialogDescription>
								The next request made with this token is refused. You cannot
								undo this: a script that uses it needs a new token.
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel>Cancel</AlertDialogCancel>
							<AlertDialogAction
								variant="destructive"
								onClick={() => {
									setOpen(false);
									revoke.mutate();
								}}
							>
								Revoke
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			}
		/>
	);
}

/**
 * Make a token, then show it — once.
 *
 * The same two stages as a new webhook endpoint's secret: the token is never
 * readable again, so the reveal has no Cancel, only the button that says it
 * has been saved.
 */
function CreateApiTokenDialog() {
	const orgSlug = useOrgSlug();
	const appOrigin = useRouteContext({
		from: "/$orgSlug",
		select: (context) => context.appOrigin,
	});
	const queryClient = useQueryClient();
	const [open, setOpen] = useState(false);
	const [token, setToken] = useState<string | null>(null);

	const form = useForm<CreateInput>({
		resolver: zodResolver(createApiTokenInput),
		defaultValues: DEFAULTS,
	});

	const mutation = useMutation({
		mutationFn: (data: CreateInput) => createApiToken({ data }),
		onSuccess: async (result) => {
			await queryClient.invalidateQueries({
				queryKey: myApiTokensQuery(orgSlug).queryKey,
			});
			setToken(result.token);
			form.reset(DEFAULTS);
		},
		onError: (error) =>
			toast.error(error.message ?? "Could not make the token"),
	});

	const close = () => {
		setOpen(false);
		setToken(null);
	};

	const origin = appOrigin ?? "https://farmer.example.com";

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (next) {
					setToken(null);
					form.reset(DEFAULTS);
				}
				setOpen(next);
			}}
		>
			<DialogTrigger render={<Button>+ New token</Button>} />
			<DialogContent>
				{token ? (
					<>
						<DialogHeader>
							<DialogTitle>Copy the token</DialogTitle>
						</DialogHeader>
						<div className="grid gap-3">
							<p className="text-sm text-muted-foreground">
								Shown once. Keep it where you keep a password. If you lose it,
								revoke it and make a new one.
							</p>
							<code className="block rounded-md bg-muted p-3 font-mono text-xs break-all select-all">
								{token}
							</code>
							<p className="text-sm text-muted-foreground">
								Send it as a bearer token:
							</p>
							<code className="block rounded-md bg-muted p-3 font-mono text-xs break-all whitespace-pre-wrap select-all">
								{`curl ${origin}/api/v1/me \\\n  -H "Authorization: Bearer ${token}"`}
							</code>
							<p className="text-sm text-muted-foreground">
								The CLI reads it from{" "}
								<code className="font-mono">FARMER_TOKEN</code>. The{" "}
								<a
									href="/api-docs"
									target="_blank"
									rel="noreferrer"
									className="underline underline-offset-2"
								>
									API reference
								</a>{" "}
								lists every endpoint.
							</p>
						</div>
						<DialogFooter>
							<Button
								variant="outline"
								onClick={() => {
									void copyToken(token);
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
							<DialogTitle>New API token</DialogTitle>
						</DialogHeader>
						<Form {...form}>
							<form
								onSubmit={form.handleSubmit((data) => mutation.mutate(data))}
								className="grid grid-cols-[minmax(0,1fr)] gap-4"
							>
								<FormField
									control={form.control}
									name="name"
									render={({ field }) => (
										<FormItem>
											<FormLabel required>Name</FormLabel>
											<InputGroup>
												<FormControl>
													<InputGroupInput
														autoFocus
														placeholder="Monthly export"
														{...field}
													/>
												</FormControl>
											</InputGroup>
											<FormMessage />
										</FormItem>
									)}
								/>
								<FormField
									control={form.control}
									name="scope"
									render={({ field }) => (
										<FormItem>
											<FormLabel>Access</FormLabel>
											<Choice
												options={SCOPES}
												value={field.value}
												onChange={field.onChange}
											/>
											<FormDescription>
												A read-only token cannot add, change or delete anything.
											</FormDescription>
										</FormItem>
									)}
								/>
								<FormField
									control={form.control}
									name="workspace"
									render={({ field }) => (
										<FormItem>
											<FormLabel>Workspaces</FormLabel>
											<Choice
												options={WORKSPACES}
												value={field.value}
												onChange={field.onChange}
											/>
										</FormItem>
									)}
								/>
								<FormField
									control={form.control}
									name="expiresInDays"
									render={({ field }) => (
										<FormItem>
											<FormLabel>Expires after</FormLabel>
											<Choice
												options={LIFETIMES}
												value={field.value}
												onChange={field.onChange}
											/>
										</FormItem>
									)}
								/>
								<DialogFooter>
									<Button type="submit" disabled={mutation.isPending}>
										Make token
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

/** One choice out of a few, as the segmented control the rest of the app
 *  uses for the same thing. */
function Choice<T extends string | number | null>({
	options,
	value,
	onChange,
}: {
	options: readonly { value: T; label: string }[];
	value: T;
	onChange: (value: T) => void;
}) {
	return (
		<SegmentedControl>
			{options.map((option) => (
				<SegmentedControlItem
					key={String(option.value)}
					active={option.value === value}
					aria-pressed={option.value === value}
					onClick={() => onChange(option.value)}
				>
					{option.label}
				</SegmentedControlItem>
			))}
		</SegmentedControl>
	);
}

/** Copy the token, and say whether it worked, as the webhook secret does. */
const copyToken = async (token: string) => {
	try {
		await navigator.clipboard.writeText(token);
		toast.success("Token copied");
	} catch {
		toast.error("Could not copy — select the text instead");
	}
};
