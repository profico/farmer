import { matchesSearch } from "@farmer/core/lib/search";
import { isValidDayKey, type WeekStartsOn } from "@farmer/core/lib/time";
import {
	isUploadedFile,
	MAX_UPLOAD_BYTES,
	UPLOAD_ACCEPT,
} from "@farmer/core/lib/uploads";
import {
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import {
	createFileRoute,
	useRouteContext,
	useRouter,
} from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { SettingsEyebrow } from "#/components/settings-nav.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
	Combobox,
	ComboboxCollection,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxItem,
	ComboboxList,
	ComboboxTrigger,
	ComboboxValue,
} from "#/components/ui/combobox.tsx";
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
import { uploadImage } from "#/server/uploads.ts";

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

// Date#getDay() numbers, as strings for the select.
const WEEK_START_ITEMS = [
	{ value: "1", label: "Monday" },
	{ value: "0", label: "Sunday" },
];

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
			timezone?: string;
			weekStartsOn?: WeekStartsOn;
			logo?: string | null;
		}) => updateOrgSettings({ data }),
		onSuccess: async (_, variables) => {
			await Promise.all([
				// The timezone decides which day every entry, meeting and "today"
				// falls on, so nothing cached for this workspace is still right.
				variables.timezone !== undefined && queryClient.invalidateQueries(),
				queryClient.invalidateQueries({
					queryKey: orgSettingsQuery(orgSlug).queryKey,
				}),
				queryClient.invalidateQueries({
					queryKey: [...queryKeys(orgSlug).holidays],
				}),
				// The home page's week target is read over the org's week.
				queryClient.invalidateQueries({
					queryKey: [...queryKeys(orgSlug).compliance],
				}),
			]);
			// The sidebar/switcher read the org (name + logo) and every week reads
			// its start day from route context, resolved in the layout's beforeLoad
			// — re-run it so a change shows immediately instead of on the next
			// navigation.
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
	const uploadedLogo = isUploadedFile(logo);

	const { uploadsEnabled } = useRouteContext({ from: "/$orgSlug" });
	const fileInput = useRef<HTMLInputElement>(null);
	const upload = useMutation({
		mutationFn: async (file: File) => {
			// The server refuses it too; checking here first saves sending it.
			if (file.size > MAX_UPLOAD_BYTES) {
				throw new Error("The image is larger than 1 MB.");
			}
			const form = new FormData();
			form.set("purpose", "org-logo");
			form.set("file", file);
			return uploadImage({ data: form });
		},
		// Saved as soon as it lands. Choosing the file was the decision, and a
		// second Save click would only be one more way to lose it.
		onSuccess: ({ url }) => {
			setLogo(url);
			mutation.mutate({ logo: url });
		},
		onError: (error) => {
			toast.error(error.message || "Could not upload the logo");
		},
	});

	return (
		<Page>
			<PageHeader
				eyebrow={<SettingsEyebrow />}
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
				title="Timezone"
				description="Decides which day an entry or a synced meeting falls on, the meeting times shown, and when today starts. On the next sync, synced meetings in the automation window move to the right day; other entries keep their day."
			>
				<TimezonePicker
					value={settings.timezone}
					onPick={(timezone) => mutation.mutate({ timezone })}
					disabled={mutation.isPending}
				/>
			</PageSection>

			<PageSection
				title="Week starts on"
				description="The first day of every week in this organization: the timesheet, the home page, week reports, date pickers and the CLI."
			>
				<Select
					value={String(settings.weekStartsOn)}
					onValueChange={(value) =>
						value && mutation.mutate({ weekStartsOn: value === "0" ? 0 : 1 })
					}
					disabled={mutation.isPending}
					items={WEEK_START_ITEMS}
				>
					<SelectTrigger className="w-full max-w-sm bg-card">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{WEEK_START_ITEMS.map((item) => (
							<SelectItem key={item.value} value={item.value}>
								{item.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</PageSection>

			<PageSection
				title={uploadsEnabled ? "Logo" : "Logo URL"}
				description={
					uploadsEnabled
						? "The organization's logo, shown in the sidebar. Upload an image, or paste a public image URL (SVG or PNG work best). Leave it empty to fall back to the organization initials."
						: "A public image URL for the organization's logo, shown in the sidebar (SVG or PNG work best). Leave empty to fall back to the organization initials."
				}
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
						{uploadedLogo ? (
							// The path of an upload means nothing to anybody, and editing
							// it by hand can only break it. Remove brings the field back.
							<p className="flex-1 text-sm text-muted-foreground">
								An uploaded image.
							</p>
						) : (
							<Input
								value={logo}
								onChange={(e) => setLogo(e.target.value)}
								placeholder="https://example.com/logo.svg"
								type="url"
								inputMode="url"
								maxLength={2048}
								className="flex-1"
							/>
						)}
					</div>
					<div className="flex gap-2">
						{!uploadedLogo && (
							<Button
								type="submit"
								size="sm"
								disabled={!logoChanged || mutation.isPending}
							>
								Save logo
							</Button>
						)}
						{uploadsEnabled && (
							<>
								<Button
									type="button"
									size="sm"
									variant="outline"
									disabled={upload.isPending || mutation.isPending}
									onClick={() => fileInput.current?.click()}
								>
									{upload.isPending ? "Uploading…" : "Upload image…"}
								</Button>
								<input
									ref={fileInput}
									type="file"
									accept={UPLOAD_ACCEPT}
									tabIndex={-1}
									aria-hidden
									className="hidden"
									onChange={(e) => {
										const file = e.currentTarget.files?.[0];
										// Cleared, so choosing the same file again still fires.
										e.currentTarget.value = "";
										if (file) upload.mutate(file);
									}}
								/>
							</>
						)}
						{settings.logo && (
							<Button
								type="button"
								size="sm"
								variant="ghost"
								className="hover:text-destructive"
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

type TimezoneItem = { value: string; label: string; offset: string };

// "GMT+02:00", or "GMT" for UTC itself. Today's offset, so a zone with daylight
// saving reads as it does now.
const offsetOf = (timeZone: string, now: Date) =>
	new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
		.formatToParts(now)
		.find((part) => part.type === "timeZoneName")?.value ?? "";

// Every IANA zone the runtime knows. `UTC` is added because not every engine
// lists it, and the stored value is added so a zone this browser does not know
// still shows as chosen.
const timezoneItems = (current: string): TimezoneItem[] => {
	const zones = new Set(["UTC", ...Intl.supportedValuesOf("timeZone")]);
	zones.add(current);
	const now = new Date();
	return [...zones].map((value) => ({
		value,
		label: value.replaceAll("_", " "),
		offset: offsetOf(value, now),
	}));
};

function TimezonePicker({
	value,
	onPick,
	disabled,
}: {
	value: string;
	onPick: (timezone: string) => void;
	disabled: boolean;
}) {
	const items = useMemo(() => timezoneItems(value), [value]);
	const selected = items.find((item) => item.value === value) ?? null;
	const [query, setQuery] = useState("");
	const filtered = useMemo(
		() =>
			query.trim() === ""
				? items
				: items.filter((item) =>
						matchesSearch(query, [item.label, item.offset]),
					),
		[items, query],
	);
	return (
		<Combobox
			items={items}
			filteredItems={filtered}
			value={selected}
			onValueChange={(item: TimezoneItem | null) => {
				if (item && item.value !== value) onPick(item.value);
			}}
			isItemEqualToValue={(a: TimezoneItem, b: TimezoneItem) =>
				a.value === b.value
			}
			itemToStringLabel={(item: TimezoneItem) => item.label}
			inputValue={query}
			onInputValueChange={setQuery}
			onOpenChange={(open) => {
				if (!open) setQuery("");
			}}
			autoHighlight
			disabled={disabled}
		>
			<ComboboxTrigger
				className="w-full max-w-sm bg-card"
				aria-label="Timezone"
			>
				<ComboboxValue>
					{() => (selected ? `${selected.label} (${selected.offset})` : value)}
				</ComboboxValue>
			</ComboboxTrigger>
			<ComboboxContent searchPlaceholder="Search timezones…">
				<ComboboxEmpty>No timezone matches.</ComboboxEmpty>
				<ComboboxList>
					<ComboboxCollection>
						{(item: TimezoneItem) => (
							<ComboboxItem key={item.value} value={item}>
								<span className="truncate">{item.label}</span>
								<span className="ml-auto shrink-0 text-xs text-muted-foreground">
									{item.offset}
								</span>
							</ComboboxItem>
						)}
					</ComboboxCollection>
				</ComboboxList>
			</ComboboxContent>
		</Combobox>
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
			description="How far below the target so far someone may be and still count as only slightly behind. Beyond it they are behind — on the Tracking report and in every reminder. The target is the month's hour fund spread over its working days (8h each, public holidays excluded); a person's total is work plus time-off."
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
	const valid = next === null || isValidDayKey(next);
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
