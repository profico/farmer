import {
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select.tsx";
import { getInitials } from "#/lib/utils.ts";
import { supportedCountriesQuery } from "#/queries/holidays.ts";
import { orgSettingsQuery } from "#/queries/organization.ts";
import { requireOrgAdmin } from "#/server/auth.ts";
import { updateOrgSettings } from "#/server/organization.ts";

export const Route = createFileRoute("/$orgSlug/settings/organization")({
	beforeLoad: async () => {
		await requireOrgAdmin();
	},
	loader: async ({ context }) => {
		await Promise.all([
			context.queryClient.ensureQueryData(orgSettingsQuery()),
			context.queryClient.ensureQueryData(supportedCountriesQuery()),
		]);
	},
	component: OrganizationSettingsPage,
});

function OrganizationSettingsPage() {
	const { data: settings } = useSuspenseQuery(orgSettingsQuery());
	const { data: countries } = useSuspenseQuery(supportedCountriesQuery());
	const queryClient = useQueryClient();
	const router = useRouter();

	const mutation = useMutation({
		mutationFn: (data: {
			name?: string;
			country?: string;
			logo?: string | null;
		}) => updateOrgSettings({ data }),
		onSuccess: async () => {
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: orgSettingsQuery().queryKey,
				}),
				queryClient.invalidateQueries({ queryKey: ["holidays"] }),
			]);
			// The sidebar/switcher read the org (name + logo) from route context,
			// resolved in the layout's beforeLoad — re-run it so a change shows
			// immediately instead of on the next navigation.
			await router.invalidate();
			toast.success("Organization settings saved");
		},
		onError: (error) => {
			toast.error(error.message ?? "Could not save organization settings");
		},
	});

	const [name, setName] = useState(settings.name);
	const trimmedName = name.trim();
	const nameChanged = trimmedName.length > 0 && trimmedName !== settings.name;

	const [logo, setLogo] = useState(settings.logo ?? "");
	const trimmedLogo = logo.trim();
	const logoChanged = trimmedLogo !== (settings.logo ?? "");

	return (
		<div className="page-shell">
			<h1 className="font-display text-xl">Organization</h1>
			<p className="mt-1 text-sm text-muted-foreground">
				General settings for this organization.
			</p>

			<div className="-mx-4 mt-8 border-t px-4 pt-6 sm:-mx-8 sm:px-8">
				<span className="text-sm font-semibold">Name</span>
				<p className="mt-1 text-xs text-muted-foreground">
					The organization's display name, shown in the sidebar and switcher.
				</p>
				<form
					className="mt-3 flex w-full max-w-sm gap-2"
					onSubmit={(e) => {
						e.preventDefault();
						if (nameChanged) mutation.mutate({ name: trimmedName });
					}}
				>
					<Input
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="Acme Inc."
						className="flex-1"
					/>
					<Button
						type="submit"
						size="sm"
						disabled={!nameChanged || mutation.isPending}
					>
						Save
					</Button>
				</form>
			</div>

			<div className="-mx-4 mt-8 border-t px-4 pt-6 sm:-mx-8 sm:px-8">
				<span className="text-sm font-semibold">Country</span>
				<p className="mt-1 text-xs text-muted-foreground">
					Used to determine public holidays across the organization.
				</p>
				<Select
					value={settings.country}
					onValueChange={(value) =>
						value && mutation.mutate({ country: value })
					}
					disabled={mutation.isPending}
					items={countries.map((c) => ({ value: c.code, label: c.name }))}
				>
					<SelectTrigger className="mt-3 w-full max-w-sm bg-card">
						<SelectValue placeholder="Select a country" />
					</SelectTrigger>
					<SelectContent>
						{countries.map((c) => (
							<SelectItem key={c.code} value={c.code}>
								{c.name}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			<div className="-mx-4 mt-8 border-t px-4 pt-6 sm:-mx-8 sm:px-8">
				<span className="text-sm font-semibold">Logo URL</span>
				<p className="mt-1 text-xs text-muted-foreground">
					A public image URL for the organization's logo, shown in the sidebar
					(SVG or PNG work best). Leave empty to fall back to the organization
					initials.
				</p>
				<form
					className="mt-3 flex w-full max-w-sm flex-col gap-3"
					onSubmit={(e) => {
						e.preventDefault();
						if (logoChanged) mutation.mutate({ logo: trimmedLogo });
					}}
				>
					<div className="flex items-center gap-3">
						<span className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-card">
							{trimmedLogo ? (
								<img
									src={trimmedLogo}
									alt=""
									className="size-full object-contain"
								/>
							) : (
								// The empty-logo fallback is the org initials (as the sidebar
								// switcher renders it), so preview that here.
								<span className="text-sm font-semibold text-muted-foreground">
									{getInitials(settings.name)}
								</span>
							)}
						</span>
						<Input
							value={logo}
							onChange={(e) => setLogo(e.target.value)}
							placeholder="https://example.com/logo.svg"
							type="url"
							inputMode="url"
							className="flex-1"
						/>
					</div>
					<div className="flex gap-2">
						<Button
							type="submit"
							size="sm"
							disabled={!logoChanged || mutation.isPending}
						>
							Save logo
						</Button>
						{settings.logo && (
							<Button
								type="button"
								size="sm"
								variant="ghost"
								disabled={mutation.isPending}
								onClick={() => {
									setLogo("");
									mutation.mutate({ logo: "" });
								}}
							>
								Remove
							</Button>
						)}
					</div>
				</form>
			</div>
		</div>
	);
}
