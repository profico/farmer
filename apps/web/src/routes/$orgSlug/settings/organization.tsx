import {
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Page, PageHeader } from "#/components/ui/page-header.tsx";
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
import { notOnInvoiceStatusOptionsQuery } from "#/queries/not-on-invoice.ts";
import {
	orgPolicySettingsQuery,
	orgSettingsQuery,
} from "#/queries/organization.ts";
import { requireOrgAdmin } from "#/server/auth.ts";
import {
	archiveNotOnInvoiceStatusOption,
	createNotOnInvoiceStatusOption,
	updateNotOnInvoiceStatusOption,
} from "#/server/not-on-invoice.ts";
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
			context.queryClient.ensureQueryData(
				notOnInvoiceStatusOptionsQuery(orgSlug),
			),
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
				eyebrow="Workspace"
				title="Organization"
				lede="General settings for this organization."
				className="mb-0"
			/>

			<div className="-mx-4 mt-7 border-t px-4 pt-6 sm:-mx-8 sm:px-8">
				<span className="eyebrow">Name</span>
				<p className="mt-2 text-sm text-muted-foreground">
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
			</div>

			<div className="-mx-4 mt-7 border-t px-4 pt-6 sm:-mx-8 sm:px-8">
				<span className="eyebrow">Country</span>
				<p className="mt-2 text-sm text-muted-foreground">
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

			<div className="-mx-4 mt-7 border-t px-4 pt-6 sm:-mx-8 sm:px-8">
				<span className="eyebrow">Logo URL</span>
				<p className="mt-2 text-sm text-muted-foreground">
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
			</div>

			<CompliancePolicySection />
			<AutomationLockSection />
			<NotOnInvoiceStatusSection />
		</Page>
	);
}

/**
 * The "not on the invoice" status set (PRD §8). A managed list rather than free
 * text on purpose: the same five words month after month are what turn the
 * report into a trend instrument (bench hours per month, time-to-billable per
 * person) instead of five separately-worded emails.
 *
 * Retiring a status archives it — every month already annotated with it keeps
 * reading correctly, which a delete would break.
 */
function NotOnInvoiceStatusSection() {
	const orgSlug = useOrgSlug();
	const queryClient = useQueryClient();
	const { data: options } = useSuspenseQuery(
		notOnInvoiceStatusOptionsQuery(orgSlug),
	);
	const [label, setLabel] = useState("");

	const invalidate = () =>
		Promise.all([
			queryClient.invalidateQueries({
				queryKey: notOnInvoiceStatusOptionsQuery(orgSlug).queryKey,
			}),
			queryClient.invalidateQueries({
				queryKey: [...queryKeys(orgSlug).notOnInvoice],
			}),
		]);

	const create = useMutation({
		mutationFn: (value: string) =>
			createNotOnInvoiceStatusOption({ data: { label: value } }),
		onSuccess: async () => {
			setLabel("");
			await invalidate();
		},
		onError: (error) => toast.error(error.message ?? "Could not add status"),
	});

	const rename = useMutation({
		mutationFn: (vars: { statusOptionId: string; label: string }) =>
			updateNotOnInvoiceStatusOption({ data: vars }),
		onSuccess: invalidate,
		onError: (error) => toast.error(error.message ?? "Could not rename"),
	});

	const archive = useMutation({
		mutationFn: (statusOptionId: string) =>
			archiveNotOnInvoiceStatusOption({ data: statusOptionId }),
		onSuccess: invalidate,
		onError: (error) => toast.error(error.message ?? "Could not remove"),
	});

	return (
		<div className="-mx-4 mt-7 border-t px-4 pt-6 sm:-mx-8 sm:px-8">
			<h2 className="eyebrow">Not on the invoice</h2>
			<p className="mt-1 max-w-prose text-sm text-muted-foreground">
				The reasons you can pick for someone who ended a month with no invoiced
				hours. Keep the list short — it only stays comparable across months if
				the same words come back.
			</p>

			<div className="mt-4 flex max-w-md flex-col">
				{options.map((option) => (
					<div
						key={option.id}
						className="flex items-center gap-2 border-t border-line2 py-2 first:border-t-0 first:pt-0"
					>
						<StatusLabelInput
							label={option.label}
							onCommit={(next) =>
								rename.mutate({ statusOptionId: option.id, label: next })
							}
						/>
						<Button
							variant="ghost"
							size="sm"
							disabled={archive.isPending}
							onClick={() => archive.mutate(option.id)}
						>
							Remove
						</Button>
					</div>
				))}
				{options.length === 0 && (
					<p className="text-sm text-muted-foreground">
						No statuses left — the report will only take free-text comments.
					</p>
				)}
			</div>

			<form
				className="mt-4 flex w-full max-w-md items-center gap-2"
				onSubmit={(e) => {
					e.preventDefault();
					const trimmed = label.trim();
					if (trimmed) create.mutate(trimmed);
				}}
			>
				<Input
					className="flex-1"
					placeholder="Add a status, e.g. Parental leave"
					value={label}
					maxLength={60}
					onChange={(e) => setLabel(e.target.value)}
				/>
				<Button
					type="submit"
					size="sm"
					disabled={label.trim() === "" || create.isPending}
				>
					Add
				</Button>
			</form>
		</div>
	);
}

// Commits on blur, like every other inline edit in Settings: a rename is a
// correction, not a decision that needs a Save button next to it.
function StatusLabelInput({
	label,
	onCommit,
}: {
	label: string;
	onCommit: (label: string) => void;
}) {
	const [value, setValue] = useState(label);
	useEffect(() => {
		setValue(label);
	}, [label]);

	return (
		<Input
			className="h-8 flex-1"
			value={value}
			maxLength={60}
			onChange={(e) => setValue(e.target.value)}
			onBlur={() => {
				const trimmed = value.trim();
				if (trimmed === "") {
					setValue(label);
					return;
				}
				if (trimmed !== label) onCommit(trimmed);
			}}
		/>
	);
}

// The one compliance number that's a setting. Everything else in that machinery
// — the 90% behind-pace threshold, the Tue/Fri reminder days, the 15-minute
// entry granularity — is deliberately hardcoded (PRD §8): they're product
// decisions, and making them configurable invites every org to tune them until
// the reports stop being comparable.
function CompliancePolicySection() {
	const orgSlug = useOrgSlug();
	const queryClient = useQueryClient();
	const { data: policy } = useSuspenseQuery(orgPolicySettingsQuery(orgSlug));
	const [days, setDays] = useState(String(policy.complianceMissingDays));

	const mutation = useMutation({
		mutationFn: (complianceMissingDays: number) =>
			updateOrgPolicySettings({ data: { complianceMissingDays } }),
		onSuccess: async () => {
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: orgPolicySettingsQuery(orgSlug).queryKey,
				}),
				queryClient.invalidateQueries({
					queryKey: [...queryKeys(orgSlug).compliance],
				}),
			]);
			toast.success("Compliance policy saved");
		},
		onError: (error) => {
			toast.error(error.message ?? "Could not save");
			setDays(String(policy.complianceMissingDays));
		},
	});

	const parsed = Number(days);
	const valid =
		Number.isInteger(parsed) &&
		parsed >= 1 &&
		parsed <= 30 &&
		days.trim() !== "";
	const changed = valid && parsed !== policy.complianceMissingDays;

	return (
		// Same section chrome as the Name/Country/Logo blocks above — without it
		// this one had no rule above it and butted straight up against the logo
		// form's buttons.
		<div className="-mx-4 mt-7 border-t px-4 pt-6 sm:-mx-8 sm:px-8">
			<h2 className="eyebrow">Tracking compliance</h2>
			<p className="mt-1 max-w-prose text-sm text-muted-foreground">
				How many working days someone may go without logging anything before
				they show up on the Tracking report and start getting Slack nudges.
			</p>
			<form
				className="mt-3 flex w-full max-w-sm items-center gap-2"
				onSubmit={(e) => {
					e.preventDefault();
					if (changed) mutation.mutate(parsed);
				}}
			>
				<Input
					className="w-20 mono text-right"
					inputMode="numeric"
					value={days}
					onChange={(e) => setDays(e.target.value)}
				/>
				<span className="text-sm text-muted-foreground">working days</span>
				<Button
					type="submit"
					size="sm"
					disabled={!changed || mutation.isPending}
					className="ml-auto"
				>
					Save
				</Button>
			</form>
		</div>
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
// finalized months on purpose (close decision 2) and this doesn't change that —
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
		<div className="-mx-4 mt-7 border-t px-4 pt-6 sm:-mx-8 sm:px-8">
			<h2 className="eyebrow">Automation lock</h2>
			<p className="mt-1 max-w-prose text-sm text-muted-foreground">
				The last day the sync engines may not touch. Recurring blocks, calendar
				meetings and commit work-time blocks stop at this date, so a month
				you've already closed can't quietly gain hours. People can still edit
				their own entries in those months — this only holds back the
				automations. Leave it empty for no lock.
			</p>
			<form
				className="mt-3 flex w-full max-w-sm items-center gap-2"
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
		</div>
	);
}
