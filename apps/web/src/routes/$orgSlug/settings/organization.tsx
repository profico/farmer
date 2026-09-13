import {
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { SettingsEyebrow } from "#/components/settings-nav.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Page, PageHeader, PageSection } from "#/components/ui/page-header.tsx";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { getInitials } from "#/lib/utils.ts";
import { supportedCountriesQuery } from "#/queries/holidays.ts";
import { queryKeys } from "#/queries/keys.ts";
import {
	orgPolicySettingsQuery,
	orgSettingsQuery,
} from "#/queries/organization.ts";
import { requireOrgAdmin } from "#/server/auth.ts";
import {
	updateOrgPolicySettings,
	updateOrgSettings,
} from "#/server/organization.ts";

export const Route = createFileRoute("/$orgSlug/settings/organization")({
	beforeLoad: async () => {
		await requireOrgAdmin();
	},
	loader: async ({ context, params }) => {
		const orgSlug = params.orgSlug;
		await Promise.all([
			context.queryClient.ensureQueryData(orgSettingsQuery(orgSlug)),
			context.queryClient.ensureQueryData(supportedCountriesQuery(orgSlug)),
			context.queryClient.ensureQueryData(orgPolicySettingsQuery(orgSlug)),
		]);
	},
	component: OrganizationSettingsPage,
});

function OrganizationSettingsPage() {
	const orgSlug = useOrgSlug();
	const { data: settings } = useSuspenseQuery(orgSettingsQuery(orgSlug));
	const { data: countries } = useSuspenseQuery(
		supportedCountriesQuery(orgSlug),
	);
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
					queryKey: orgSettingsQuery(orgSlug).queryKey,
				}),
				queryClient.invalidateQueries({
					queryKey: [...queryKeys(orgSlug).holidays],
				}),
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
	const nameChanged =
		trimmedName.length > 0 &&
		trimmedName.length <= 120 &&
		trimmedName !== settings.name;

	const [logo, setLogo] = useState(settings.logo ?? "");
	const trimmedLogo = logo.trim();
	const logoChanged = trimmedLogo !== (settings.logo ?? "");

	return (
		<Page>
			<PageHeader
				eyebrow={<SettingsEyebrow>Workspace</SettingsEyebrow>}
				title="Organization"
				lede="General settings for this organization."
			/>

			<PageSection
				title="Name"
				description="The organization's display name, shown in the sidebar and switcher."
			>
				<form
					className="flex w-full max-w-sm gap-2"
					onSubmit={(e) => {
						e.preventDefault();
						if (nameChanged) mutation.mutate({ name: trimmedName });
					}}
				>
					<Input
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="Acme Inc."
						maxLength={120}
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
			</PageSection>

			<PageSection
				title="Country"
				description="Used to determine public holidays across the organization."
			>
				<Select
					value={settings.country}
					onValueChange={(value) =>
						value && mutation.mutate({ country: value })
					}
					disabled={mutation.isPending}
					items={countries.map((c) => ({ value: c.code, label: c.name }))}
				>
					<SelectTrigger className="w-full max-w-sm bg-card">
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
			</PageSection>

			<PageSection
				title="Logo URL"
				description="A public image URL for the organization's logo, shown in the sidebar (SVG or PNG work best). Leave empty to fall back to the organization initials."
			>
				<form
					className="flex w-full max-w-sm flex-col gap-3"
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
								<span className="eyebrow">{getInitials(settings.name)}</span>
							)}
						</span>
						<Input
							value={logo}
							onChange={(e) => setLogo(e.target.value)}
							placeholder="https://example.com/logo.svg"
							type="url"
							inputMode="url"
							maxLength={2048}
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
			</PageSection>

			<TrackingToleranceSection />
			<AutomationLockSection />
		</Page>
	);
}

// Commits on blur, like every other inline edit in Settings: a rename is a
// correction, not a decision that needs a Save button next to it.

// The Tracking rule's one knob. Everything else in that rule — Monday-to-Friday
// proration, work + time-off as the total, the fund from Settings → Hour fund —
// is fixed, so the reports stay comparable between orgs and months.
function TrackingToleranceSection() {
	const orgSlug = useOrgSlug();
	const queryClient = useQueryClient();
	const { data: policy } = useSuspenseQuery(orgPolicySettingsQuery(orgSlug));
	const [pct, setPct] = useState(String(policy.trackingTolerancePct));

	const mutation = useMutation({
		mutationFn: (trackingTolerancePct: number) =>
			updateOrgPolicySettings({ data: { trackingTolerancePct } }),
		onSuccess: async () => {
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: orgPolicySettingsQuery(orgSlug).queryKey,
				}),
				queryClient.invalidateQueries({
					queryKey: [...queryKeys(orgSlug).compliance],
				}),
			]);
			toast.success("Tracking tolerance saved");
		},
		onError: (error) => {
			toast.error(error.message ?? "Could not save");
			setPct(String(policy.trackingTolerancePct));
		},
	});

	const parsed = Number(pct);
	const valid =
		Number.isInteger(parsed) &&
		parsed >= 0 &&
		parsed <= 50 &&
		pct.trim() !== "";
	const changed = valid && parsed !== policy.trackingTolerancePct;

	return (
		<PageSection
			title="Tracking tolerance"
			description="How far below the target so far someone may be and still count as only slightly behind. Beyond it they are behind — on the Tracking report and in every reminder. The target is the month's hour fund prorated by the working days elapsed; a person's total is work plus time-off."
		>
			<form
				className="flex w-full max-w-sm items-center gap-2"
				onSubmit={(e) => {
					e.preventDefault();
					if (changed) mutation.mutate(parsed);
				}}
			>
				<Input
					className="w-20 mono text-right"
					inputMode="numeric"
					value={pct}
					onChange={(e) => setPct(e.target.value)}
				/>
				<span className="text-sm text-muted-foreground">% (0–50)</span>
				<Button
					type="submit"
					size="sm"
					disabled={!changed || mutation.isPending}
					className="ml-auto"
				>
					Save
				</Button>
			</form>
		</PageSection>
	);
}

// The automation lock: the last day the sync engines may not write to.
//
// It exists because the engines reach a few days back — that grace window is
// how a day still gets its meetings and commit blocks if the worker was down
// over a weekend. Harmless most of the time, except at the turn of the month:
// for the first days of every month that window reaches into the month that was
// just reconciled and invoiced. Setting this to the last day of a closed month
// is how you say "that one's done."
//
// It locks the automations, not the people. Entries stay hand-editable in
// reconciled months on purpose and this doesn't change that —
// hence the copy below, which has to be specific or it reads like a freeze on
// everything.
function AutomationLockSection() {
	const orgSlug = useOrgSlug();
	const queryClient = useQueryClient();
	const { data: policy } = useSuspenseQuery(orgPolicySettingsQuery(orgSlug));
	const [value, setValue] = useState(policy.automationLockedThrough ?? "");

	const mutation = useMutation({
		mutationFn: (automationLockedThrough: string | null) =>
			updateOrgPolicySettings({ data: { automationLockedThrough } }),
		onSuccess: async (_result, submitted) => {
			await queryClient.invalidateQueries({
				queryKey: orgPolicySettingsQuery(orgSlug).queryKey,
			});
			toast.success(
				submitted
					? `Automation locked through ${submitted}`
					: "Automation lock cleared",
			);
		},
		onError: (error) => {
			toast.error(error.message ?? "Could not save");
			setValue(policy.automationLockedThrough ?? "");
		},
	});

	// An empty field is a real value here — it means "no lock" — so it is valid,
	// and "changed" has to compare against null rather than against "".
	const trimmed = value.trim();
	const next = trimmed === "" ? null : trimmed;
	const valid =
		next === null ||
		(/^\d{4}-\d{2}-\d{2}$/.test(next) &&
			!Number.isNaN(new Date(`${next}T00:00:00Z`).getTime()) &&
			new Date(`${next}T00:00:00Z`).toISOString().startsWith(next));
	const changed = valid && next !== (policy.automationLockedThrough ?? null);

	return (
		<PageSection
			title="Automation lock"
			description="The last day the sync engines may not touch. Recurring blocks, calendar meetings and commit work-time blocks stop at this date, so a month you've already closed can't quietly gain hours. People can still edit their own entries in those months — this only holds back the automations. Leave it empty for no lock."
		>
			<form
				className="flex w-full max-w-sm items-center gap-2"
				onSubmit={(e) => {
					e.preventDefault();
					if (changed) mutation.mutate(next);
				}}
			>
				<Input
					className="w-40 mono"
					type="date"
					value={value}
					onChange={(e) => setValue(e.target.value)}
				/>
				<Button
					type="submit"
					size="sm"
					disabled={!changed || mutation.isPending}
					className="ml-auto"
				>
					Save
				</Button>
			</form>
		</PageSection>
	);
}
