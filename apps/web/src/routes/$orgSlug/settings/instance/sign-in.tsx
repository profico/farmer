import type { OAuthProviderView } from "@farmer/core/services";
import { zodResolver } from "@hookform/resolvers/zod";
import { PlusIcon } from "@phosphor-icons/react";
import {
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import {
	InstanceSettingsForm,
	requirePlatformAdmin,
} from "#/components/instance-settings.tsx";
import { SettingsEyebrow } from "#/components/settings-nav.tsx";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "#/components/ui/alert-dialog.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
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
	Page,
	PageHeader,
	PageSection,
	SettingList,
	SettingRow,
} from "#/components/ui/page-header.tsx";
import { RowActions } from "#/components/ui/row-actions.tsx";
import { Switch } from "#/components/ui/switch.tsx";
import {
	instanceOAuthProvidersQuery,
	instanceSettingsQuery,
} from "#/queries/instance-settings.ts";
import { platformKeys } from "#/queries/keys.ts";
import {
	createInstanceOAuthProvider,
	deleteInstanceOAuthProvider,
	updateInstanceOAuthProvider,
} from "#/server/instance-settings.ts";

/**
 * Who may sign in, and with what: the registration rule, Google, and any
 * number of OpenID Connect sources (Authentik, Keycloak, Entra ID…).
 *
 * The OIDC sources are rows rather than settings, because there can be any
 * number of them, so they get their own list and dialog under the registry's
 * fields. Each one is the deployment's, not a workspace's (issue #75, decision
 * 4): a source added here shows on the sign-in page of every workspace.
 *
 * **The ID is fixed once the source exists.** It is in the callback URL
 * registered at the provider and in every account linked through it, so the
 * dialog shows it read-only on edit, and the service ignores a new one.
 */
export const Route = createFileRoute("/$orgSlug/settings/instance/sign-in")({
	beforeLoad: requirePlatformAdmin,
	loader: async ({ context }) => {
		await Promise.all([
			context.queryClient.ensureQueryData(instanceSettingsQuery()),
			context.queryClient.ensureQueryData(instanceOAuthProvidersQuery()),
		]);
	},
	component: SignInSettingsPage,
});

/** The service's own rule (`instance-settings.service.ts`), repeated so the
 *  box can say what is wrong before a round trip. The service still decides. */
const PROVIDER_ID = /^[a-z0-9][a-z0-9-]{1,39}$/;

const isHttpUrl = (value: string) => {
	const url = URL.parse(value);
	return url?.protocol === "https:" || url?.protocol === "http:";
};

const providerForm = z.object({
	name: z.string().trim().min(1, "Required").max(80),
	providerId: z
		.string()
		.trim()
		.regex(PROVIDER_ID, "2 to 40 lowercase letters, digits or hyphens"),
	baseUrl: z.string().trim().refine(isHttpUrl, "An http(s) URL"),
	clientId: z.string().trim().min(1, "Required").max(500),
	clientSecret: z.string().max(2_000),
	scopes: z.string().max(500),
});

type ProviderForm = z.infer<typeof providerForm>;

const EMPTY_PROVIDER: ProviderForm = {
	name: "",
	providerId: "",
	baseUrl: "",
	clientId: "",
	clientSecret: "",
	scopes: "",
};

/** The URL to register at the provider. better-auth's generic OAuth plugin
 *  answers on this path, one per source. */
const callbackUrl = (appOrigin: string, providerId: string) =>
	`${appOrigin}/api/auth/oauth2/callback/${providerId}`;

const copy = async (value: string) => {
	try {
		await navigator.clipboard.writeText(value);
		toast.success("Callback URL copied");
	} catch {
		// Same rule as the MCP URL on Integrations: say so rather than do
		// nothing, since the URL is on screen to select.
		toast.error("Could not copy — select the text instead");
	}
};

function SignInSettingsPage() {
	return (
		<Page>
			<PageHeader
				eyebrow={<SettingsEyebrow />}
				title="Sign-in"
				lede="Who may create an account on this deployment, and the accounts they can sign in with."
			/>

			<InstanceSettingsForm
				section="sign-in"
				groupNotes={{
					Registration:
						"This switch decides who may create an account. It never stops a person who already has one from signing in.",
				}}
			/>

			<OAuthProvidersSection />
		</Page>
	);
}

function OAuthProvidersSection() {
	const queryClient = useQueryClient();
	const { appOrigin } = Route.useRouteContext();
	const { data: providers } = useSuspenseQuery(instanceOAuthProvidersQuery());
	// `null` is "closed", `"new"` is the create dialog, a row is its edit.
	const [editing, setEditing] = useState<OAuthProviderView | "new" | null>(
		null,
	);
	const [deleting, setDeleting] = useState<OAuthProviderView | null>(null);

	const invalidate = () =>
		queryClient.invalidateQueries({ queryKey: platformKeys.oauthProviders });

	const toggle = useMutation({
		mutationFn: (provider: OAuthProviderView) =>
			updateInstanceOAuthProvider({
				data: {
					id: provider.id,
					name: provider.name,
					baseUrl: provider.baseUrl,
					clientId: provider.clientId,
					scopes: provider.scopes,
					enabled: !provider.enabled,
				},
			}),
		onSuccess: async (_result, provider) => {
			await invalidate();
			toast.success(
				provider.enabled ? `${provider.name} is off` : `${provider.name} is on`,
			);
		},
		onError: (error: Error) => toast.error(error.message),
	});

	const remove = useMutation({
		mutationFn: (id: string) => deleteInstanceOAuthProvider({ data: { id } }),
		onSuccess: async () => {
			await invalidate();
			setDeleting(null);
			toast.success("Provider deleted");
		},
		onError: (error: Error) => toast.error(error.message),
	});

	return (
		<PageSection
			title="OpenID Connect providers"
			description="Any provider that publishes an OpenID Connect discovery document, such as Authentik, Keycloak or Entra ID. Each one gets its own button on the sign-in page."
			action={
				<Button variant="outline" onClick={() => setEditing("new")}>
					<PlusIcon weight="regular" />
					Add provider
				</Button>
			}
		>
			{providers.length === 0 ? (
				<p className="text-sm text-muted-foreground">No providers yet.</p>
			) : (
				<SettingList>
					{providers.map((provider) => (
						<SettingRow
							key={provider.id}
							title={provider.name}
							badge={
								<Badge variant="outline" className="font-mono">
									{provider.providerId}
								</Badge>
							}
							description={
								<span className="grid gap-1">
									<span className="break-all">{provider.baseUrl}</span>
									<span className="break-all">
										Callback URL:{" "}
										<code className="font-mono text-xs">
											{callbackUrl(appOrigin, provider.providerId)}
										</code>
									</span>
								</span>
							}
							action={
								<div className="flex items-center gap-2">
									<Switch
										aria-label={`${provider.name} on`}
										checked={provider.enabled}
										disabled={toggle.isPending}
										onCheckedChange={() => toggle.mutate(provider)}
									/>
									<RowActions
										actions={[
											{
												label: "Copy callback URL",
												onClick: () =>
													void copy(
														callbackUrl(appOrigin, provider.providerId),
													),
											},
											{ label: "Edit", onClick: () => setEditing(provider) },
											{
												label: "Delete",
												variant: "destructive",
												onClick: () => setDeleting(provider),
											},
										]}
									/>
								</div>
							}
						/>
					))}
				</SettingList>
			)}

			<ProviderDialog
				// A fresh form per open, so an edit never starts from the last one.
				key={editing === null || editing === "new" ? "new" : editing.id}
				provider={editing}
				appOrigin={appOrigin}
				onClose={() => setEditing(null)}
			/>

			<AlertDialog
				open={deleting !== null}
				onOpenChange={(open) => {
					if (!open) setDeleting(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle>
						<AlertDialogDescription>
							Its button leaves the sign-in page. People who signed in only
							through it lose that way in, until you add it again with the same
							ID.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							disabled={remove.isPending}
							onClick={() => {
								if (deleting) remove.mutate(deleting.id);
							}}
						>
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</PageSection>
	);
}

/**
 * Add a source, or edit one.
 *
 * The client secret follows the settings form's rule: never sent back, so
 * never prefilled. Required to create one; on edit, an empty box keeps the
 * stored secret, and the placeholder shows its first characters.
 */
function ProviderDialog({
	provider,
	appOrigin,
	onClose,
}: {
	provider: OAuthProviderView | "new" | null;
	appOrigin: string;
	onClose: () => void;
}) {
	const queryClient = useQueryClient();
	const existing = provider !== null && provider !== "new" ? provider : null;

	const form = useForm<ProviderForm>({
		resolver: zodResolver(providerForm),
		defaultValues: existing
			? {
					name: existing.name,
					providerId: existing.providerId,
					baseUrl: existing.baseUrl,
					clientId: existing.clientId,
					clientSecret: "",
					scopes: existing.scopes,
				}
			: EMPTY_PROVIDER,
	});
	const providerId = useWatch({
		control: form.control,
		name: "providerId",
	}).trim();

	const save = useMutation({
		mutationFn: async (values: ProviderForm) => {
			const secret = values.clientSecret.trim();
			if (existing) {
				await updateInstanceOAuthProvider({
					data: {
						id: existing.id,
						name: values.name,
						baseUrl: values.baseUrl,
						clientId: values.clientId,
						// Left out when empty: the service keeps the stored one.
						clientSecret: secret === "" ? undefined : secret,
						scopes: values.scopes,
						enabled: existing.enabled,
					},
				});
				return;
			}
			await createInstanceOAuthProvider({
				data: { ...values, clientSecret: secret, enabled: true },
			});
		},
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: platformKeys.oauthProviders,
			});
			toast.success(existing ? "Provider saved" : "Provider added");
			onClose();
		},
		onError: (error: Error) => toast.error(error.message),
	});

	return (
		<Dialog
			open={provider !== null}
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						{existing
							? `Edit ${existing.name}`
							: "Add an OpenID Connect provider"}
					</DialogTitle>
					<DialogDescription>
						Register this callback URL at the provider:{" "}
						<code className="font-mono text-xs break-all">
							{callbackUrl(appOrigin, providerId || "{id}")}
						</code>
					</DialogDescription>
				</DialogHeader>
				<Form {...form}>
					<form
						onSubmit={form.handleSubmit((values) => {
							if (!existing && values.clientSecret.trim() === "") {
								form.setError("clientSecret", { message: "Required" });
								return;
							}
							save.mutate(values);
						})}
						className="grid grid-cols-[minmax(0,1fr)] gap-4"
					>
						<FormField
							control={form.control}
							name="name"
							render={({ field }) => (
								<FormItem>
									<FormLabel required>Display name</FormLabel>
									<InputGroup>
										<FormControl>
											<InputGroupInput placeholder="Company login" {...field} />
										</FormControl>
										<FormMessage />
									</InputGroup>
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="providerId"
							render={({ field }) => (
								<FormItem>
									<FormLabel required>ID</FormLabel>
									<InputGroup>
										<FormControl>
											<InputGroupInput
												placeholder="authentik"
												disabled={existing !== null}
												className="font-mono"
												{...field}
											/>
										</FormControl>
										<FormMessage />
									</InputGroup>
									<FormDescription>
										{existing
											? "Fixed: it is in the callback URL and in every linked account."
											: "Part of the callback URL. You cannot change it later."}
									</FormDescription>
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="baseUrl"
							render={({ field }) => (
								<FormItem>
									<FormLabel required>Base URL</FormLabel>
									<InputGroup>
										<FormControl>
											<InputGroupInput
												placeholder="https://auth.example.com/application/o/farmer/"
												{...field}
											/>
										</FormControl>
										<FormMessage />
									</InputGroup>
									<FormDescription>
										The issuer. Farmer reads its
										/.well-known/openid-configuration.
									</FormDescription>
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="clientId"
							render={({ field }) => (
								<FormItem>
									<FormLabel required>Client ID</FormLabel>
									<InputGroup>
										<FormControl>
											<InputGroupInput {...field} />
										</FormControl>
										<FormMessage />
									</InputGroup>
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="clientSecret"
							render={({ field }) => (
								<FormItem>
									<FormLabel required={!existing}>Client secret</FormLabel>
									<InputGroup>
										<FormControl>
											<InputGroupInput
												type="password"
												autoComplete="new-password"
												placeholder={
													existing
														? `${existing.secretHint} — empty keeps it`
														: undefined
												}
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
							name="scopes"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Scopes</FormLabel>
									<InputGroup>
										<FormControl>
											<InputGroupInput
												placeholder="openid email profile"
												{...field}
											/>
										</FormControl>
										<FormMessage />
									</InputGroup>
									<FormDescription>Separated by spaces.</FormDescription>
								</FormItem>
							)}
						/>
						<DialogFooter>
							<Button type="submit" disabled={save.isPending}>
								{existing ? "Save" : "Add provider"}
							</Button>
						</DialogFooter>
					</form>
				</Form>
			</DialogContent>
		</Dialog>
	);
}
