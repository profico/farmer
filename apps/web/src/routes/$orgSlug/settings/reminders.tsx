import { dayKeyInTz, isValidDayKey } from "@farmer/core/lib/time";
import {
	MAX_MONTH_END_DAYS_BEFORE,
	MAX_NUDGE_DAYS,
	REMINDER_EARLIEST_TIME,
	REMINDER_LATEST_TIME,
	type ReminderKind,
	type ReminderSettings,
	type UpdateReminderSettingsInput,
	updateReminderSettingsInput,
} from "@farmer/core/schema";
import {
	useMutation,
	useQuery,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { type ReactNode, useId, useState } from "react";
import { toast } from "sonner";

import { SettingsEyebrow } from "#/components/settings-nav.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "#/components/ui/dialog.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Label } from "#/components/ui/label.tsx";
import {
	Page,
	PageHeader,
	PageSection,
	SettingList,
	SettingRow,
} from "#/components/ui/page-header.tsx";
import { PillToggleGroup } from "#/components/ui/pill-toggle-group.tsx";
import {
	SegmentedControl,
	SegmentedControlItem,
} from "#/components/ui/segmented-control.tsx";
import { Switch } from "#/components/ui/switch.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { useWeekdays } from "#/hooks/use-week-starts-on.ts";
import { queryKeys } from "#/queries/keys.ts";
import { orgPolicySettingsQuery } from "#/queries/organization.ts";
import {
	reminderPreviewQuery,
	reminderSettingsQuery,
} from "#/queries/reminder-settings.ts";
import { requireOrgAdmin } from "#/server/auth.ts";
import {
	type previewReminder,
	updateReminderSettings,
} from "#/server/reminder-settings.ts";

// Settings → Reminders (docs/plans/reminder-settings.md). One card per
// reminder, each with the switch that turns it off and the fields that say
// when it goes out and to whom.
//
// The switch saves the moment it flips; the fields are a draft with a Save
// button. A half-typed time or a third nudge day ticked on the way to
// unticking another is not a setting anybody meant to send a whole company.
//
// Every limit on this page is the schema's, shown next to the field it binds.
// Reminders sent too often get muted, and the limits are what is left of the
// reason these used to be constants.

export const Route = createFileRoute("/$orgSlug/settings/reminders")({
	beforeLoad: async () => {
		await requireOrgAdmin();
	},
	loader: async ({ context, params }) => {
		await context.queryClient.ensureQueryData(
			reminderSettingsQuery(params.orgSlug),
		);
	},
	component: RemindersPage,
});

type ReminderPreview = Awaited<ReturnType<typeof previewReminder>>;

// Overhead employees are not here on purpose: nobody is nagged about a
// timesheet that nobody reads, so it is not a choice the page offers.
const MEMBER_TYPES = [
	"employee_billable",
	"student_full_time",
	"student_hourly",
	"contractor_full_time",
	"contractor_hourly",
] as const;
const MEMBER_TYPE_ITEMS = [
	{ id: "employee_billable", label: "Employees" },
	{ id: "student_full_time", label: "Students · full-time" },
	{ id: "student_hourly", label: "Students · hourly" },
	{ id: "contractor_full_time", label: "Contractors · full-time" },
	{ id: "contractor_hourly", label: "Contractors · hourly" },
];

const TIME_HINT = `${REMINDER_EARLIEST_TIME}–${REMINDER_LATEST_TIME}, on the quarter hour. Workspace time.`;

/** Every save stales the settings (and with them every open preview), the
 *  policy the Organization page shows, and the compliance report, which reads
 *  the same "no entries" N. */
function useSaveReminders() {
	const orgSlug = useOrgSlug();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (patch: UpdateReminderSettingsInput) =>
			updateReminderSettings({ data: patch }),
		onSuccess: async () => {
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: [...queryKeys(orgSlug).reminderSettings],
				}),
				queryClient.invalidateQueries({
					queryKey: orgPolicySettingsQuery(orgSlug).queryKey,
				}),
				queryClient.invalidateQueries({
					queryKey: [...queryKeys(orgSlug).compliance],
				}),
			]);
		},
		onError: (error) => toast.error(error.message ?? "Could not save"),
	});
}

function RemindersPage() {
	const weekdays = useWeekdays();
	const orgSlug = useOrgSlug();
	const { data: settings } = useSuspenseQuery(reminderSettingsQuery(orgSlug));
	const save = useSaveReminders();

	return (
		<Page>
			<PageHeader
				eyebrow={<SettingsEyebrow />}
				title="Reminders"
				lede="When each reminder goes out, and to whom. Nothing goes out before 07:00 or after 20:00, and nobody who is archived gets any of them."
			/>

			<PageSection title="Who can get a reminder">
				<SettingList>
					<SettingRow
						title="People who have never signed in"
						action={
							<Switch
								aria-label="Remind people who have never signed in"
								checked={settings.includeNeverSignedIn}
								disabled={save.isPending}
								onCheckedChange={(includeNeverSignedIn) =>
									save.mutate(
										{ includeNeverSignedIn },
										{
											onSuccess: () =>
												toast.success(
													includeNeverSignedIn
														? "People who have never signed in now get reminders"
														: "People who have never signed in no longer get reminders",
												),
										},
									)
								}
							/>
						}
					/>
				</SettingList>
			</PageSection>

			<ReminderCard
				key={draftKey(logDraft(settings))}
				kind="log-reminder"
				title="Log reminder"
				description="A push notification to anyone who has logged less than their day, sent once a day."
				enabled={settings.logEnabled}
				onEnabledChange={(logEnabled) => save.mutate({ logEnabled })}
				saved={logDraft(settings)}
			>
				{(draft, set) => (
					<>
						<FieldRow label="Send it">
							<SegmentedControl>
								<SegmentedControlItem
									active={draft.logMode === "end_of_day"}
									onClick={() => set({ logMode: "end_of_day" })}
								>
									At the end of each person's workday
								</SegmentedControlItem>
								<SegmentedControlItem
									active={draft.logMode === "fixed"}
									onClick={() => set({ logMode: "fixed" })}
								>
									At a fixed time
								</SegmentedControlItem>
							</SegmentedControl>
						</FieldRow>
						{draft.logMode === "fixed" ? (
							<TimeField
								label="Time"
								value={draft.logTime}
								onChange={(logTime) => set({ logTime })}
							/>
						) : (
							<p className="text-sm text-muted-foreground">
								The end of the workday comes from each person's own schedule, so
								it is not limited to {REMINDER_EARLIEST_TIME}–
								{REMINDER_LATEST_TIME}.
							</p>
						)}
						<NumberField
							label="Remind when the day is below"
							suffix="% of the expected hours"
							value={draft.logBelowPct}
							onChange={(logBelowPct) => set({ logBelowPct })}
							hint="1–100. At 100, anyone short of a full day gets it."
						/>
					</>
				)}
			</ReminderCard>

			<ReminderCard
				key={draftKey(nudgeDraft(settings))}
				kind="compliance-nudge"
				title="Slack nudge"
				description="A Slack message to people behind the month's target by more than the tolerance under Organization. Never on a weekend or a holiday."
				enabled={settings.nudgeEnabled}
				onEnabledChange={(nudgeEnabled) => save.mutate({ nudgeEnabled })}
				saved={nudgeDraft(settings)}
			>
				{(draft, set) => (
					<>
						<FieldRow
							label="Days"
							hint={`At most ${MAX_NUDGE_DAYS} days a week.`}
						>
							<PillToggleGroup
								items={weekdays.map((w) => ({
									id: String(w.day),
									label: w.label,
								}))}
								selectedIds={draft.nudgeWeekdays.map(String)}
								onToggle={(id) =>
									set({
										nudgeWeekdays: toggleDay(draft.nudgeWeekdays, Number(id)),
									})
								}
							/>
						</FieldRow>
						<TimeField
							label="Time"
							value={draft.nudgeTime}
							onChange={(nudgeTime) => set({ nudgeTime })}
						/>
						<MemberTypesField
							value={draft.nudgeMemberTypes}
							onChange={(nudgeMemberTypes) => set({ nudgeMemberTypes })}
						/>
					</>
				)}
			</ReminderCard>

			<ReminderCard
				key={draftKey(monthEndDraft(settings))}
				kind="month-end"
				title="Month-end reminder"
				description="A Slack message before the month ends, to log anything still missing."
				enabled={settings.monthEndEnabled}
				onEnabledChange={(monthEndEnabled) => save.mutate({ monthEndEnabled })}
				saved={monthEndDraft(settings)}
			>
				{(draft, set) => (
					<>
						<NumberField
							label="Send it"
							suffix="working days before the last working day of the month"
							value={draft.monthEndDaysBefore}
							onChange={(monthEndDaysBefore) => set({ monthEndDaysBefore })}
							hint={`0–${MAX_MONTH_END_DAYS_BEFORE}. At 0, it goes out on the last working day itself.`}
						/>
						<TimeField
							label="Time"
							value={draft.monthEndTime}
							onChange={(monthEndTime) => set({ monthEndTime })}
						/>
						<ConditionRow
							label="Only to people who are behind pace"
							checked={draft.monthEndOnlyBehind}
							onCheckedChange={(monthEndOnlyBehind) =>
								set({ monthEndOnlyBehind })
							}
						>
							<span className="text-sm text-muted-foreground">
								Behind means below the Slack nudge's percentage.
							</span>
						</ConditionRow>
						<MemberTypesField
							value={draft.monthEndMemberTypes}
							onChange={(monthEndMemberTypes) => set({ monthEndMemberTypes })}
						/>
					</>
				)}
			</ReminderCard>

			<ReminderCard
				key={draftKey(digestDraft(settings))}
				kind="admin-digest"
				title="Admin digest"
				description="A weekly Slack summary to every admin: who has logged nothing, and who is behind pace."
				enabled={settings.digestEnabled}
				onEnabledChange={(digestEnabled) => save.mutate({ digestEnabled })}
				saved={digestDraft(settings)}
			>
				{(draft, set) => (
					<>
						<FieldRow label="Day">
							<SegmentedControl>
								{weekdays.map((w) => (
									<SegmentedControlItem
										key={w.day}
										active={draft.digestWeekday === w.day}
										onClick={() => set({ digestWeekday: w.day })}
									>
										{w.label}
									</SegmentedControlItem>
								))}
							</SegmentedControl>
						</FieldRow>
						<TimeField
							label="Time"
							value={draft.digestTime}
							onChange={(digestTime) => set({ digestTime })}
						/>
					</>
				)}
			</ReminderCard>
		</Page>
	);
}

// Each card's slice of the settings: the fields its Save sends, and nothing
// else, so a save on one card cannot write back another card's stale value.
const logDraft = (s: ReminderSettings) => ({
	logMode: s.logMode,
	logTime: s.logTime,
	logBelowPct: s.logBelowPct,
});
const nudgeDraft = (s: ReminderSettings) => ({
	nudgeWeekdays: s.nudgeWeekdays,
	nudgeTime: s.nudgeTime,
	nudgeMemberTypes: s.nudgeMemberTypes,
});
const monthEndDraft = (s: ReminderSettings) => ({
	monthEndDaysBefore: s.monthEndDaysBefore,
	monthEndTime: s.monthEndTime,
	monthEndOnlyBehind: s.monthEndOnlyBehind,
	monthEndMemberTypes: s.monthEndMemberTypes,
});
const digestDraft = (s: ReminderSettings) => ({
	digestWeekday: s.digestWeekday,
	digestTime: s.digestTime,
});

// The card remounts, and so drops its draft, when its saved slice changes —
// after its own save, and when another tab saved the same fields. The store-
// the-previous-prop idiom would do the same for one field; a card has seven.
const draftKey = (slice: UpdateReminderSettingsInput) => JSON.stringify(slice);

const toggleDay = (days: number[], day: number) =>
	(days.includes(day) ? days.filter((d) => d !== day) : [...days, day]).sort(
		(a, b) => a - b,
	);

function ReminderCard<T extends UpdateReminderSettingsInput>({
	kind,
	title,
	description,
	enabled,
	onEnabledChange,
	saved,
	children,
}: {
	kind: ReminderKind;
	title: string;
	description: string;
	enabled: boolean;
	onEnabledChange: (enabled: boolean) => void;
	saved: T;
	children: (draft: T, set: (patch: Partial<T>) => void) => ReactNode;
}) {
	const [draft, setDraft] = useState(saved);
	const save = useSaveReminders();
	const parsed = updateReminderSettingsInput.safeParse(draft);
	const problem = parsed.success ? null : parsed.error.issues[0]?.message;
	const changed = draftKey(draft) !== draftKey(saved);

	return (
		<PageSection
			title={title}
			description={description}
			action={
				<div className="flex items-center gap-3">
					<PreviewDialog kind={kind} title={title} />
					<Switch
						aria-label={`${title} on`}
						checked={enabled}
						onCheckedChange={(on) => {
							onEnabledChange(on);
							toast.success(`${title} ${on ? "on" : "off"}`);
						}}
					/>
				</div>
			}
		>
			<form
				className="flex max-w-2xl flex-col gap-5"
				onSubmit={(e) => {
					e.preventDefault();
					if (!changed || problem) return;
					save.mutate(draft, {
						onSuccess: () => toast.success(`${title} saved`),
					});
				}}
			>
				{children(draft, (patch) => setDraft({ ...draft, ...patch }))}
				<div className="flex items-center gap-3">
					<Button
						type="submit"
						size="sm"
						disabled={!changed || Boolean(problem) || save.isPending}
					>
						{save.isPending ? "Saving…" : "Save"}
					</Button>
					{changed && (
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={() => setDraft(saved)}
						>
							Discard
						</Button>
					)}
					{problem && <p className="text-sm text-destructive">{problem}</p>}
				</div>
			</form>
		</PageSection>
	);
}

function FieldRow({
	label,
	htmlFor,
	hint,
	children,
}: {
	label: string;
	htmlFor?: string;
	hint?: string;
	children: ReactNode;
}) {
	return (
		<div className="flex flex-col items-start gap-2">
			{htmlFor ? (
				<Label htmlFor={htmlFor}>{label}</Label>
			) : (
				<span className="text-sm font-medium">{label}</span>
			)}
			{children}
			{hint && <p className="text-xs text-muted-foreground">{hint}</p>}
		</div>
	);
}

function TimeField({
	label,
	value,
	onChange,
}: {
	label: string;
	value: string;
	onChange: (time: string) => void;
}) {
	const id = useId();
	return (
		<FieldRow label={label} htmlFor={id} hint={TIME_HINT}>
			<Input
				id={id}
				type="time"
				// The browser's own picker steps in quarter hours and stops at the
				// limits; the schema is what actually enforces both.
				step={900}
				min={REMINDER_EARLIEST_TIME}
				max={REMINDER_LATEST_TIME}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				className="w-32"
			/>
		</FieldRow>
	);
}

function NumberInput({
	label,
	value,
	onChange,
	id,
}: {
	label: string;
	value: number;
	onChange: (value: number) => void;
	id?: string;
}) {
	return (
		<Input
			id={id}
			aria-label={id ? undefined : label}
			className="h-8 w-16 mono text-right"
			inputMode="numeric"
			value={String(value)}
			// Digits only: an emptied field reads as 0, which the schema then names
			// as out of range rather than the page guessing what was meant.
			onChange={(e) => onChange(Number(e.target.value.replace(/\D/g, "")))}
		/>
	);
}

function NumberField({
	label,
	suffix,
	value,
	onChange,
	hint,
}: {
	label: string;
	suffix: string;
	value: number;
	onChange: (value: number) => void;
	hint: string;
}) {
	const id = useId();
	return (
		<FieldRow label={label} htmlFor={id} hint={hint}>
			<div className="flex items-center gap-2">
				<NumberInput id={id} label={label} value={value} onChange={onChange} />
				<span className="text-sm text-muted-foreground">{suffix}</span>
			</div>
		</FieldRow>
	);
}

/** A condition with its switch, and the fields that only mean something while
 *  it is on. */
function ConditionRow({
	label,
	checked,
	onCheckedChange,
	children,
}: {
	label: string;
	checked: boolean;
	onCheckedChange: (checked: boolean) => void;
	children: ReactNode;
}) {
	return (
		<div className="flex flex-wrap items-center gap-3">
			<Switch
				size="sm"
				aria-label={label}
				checked={checked}
				onCheckedChange={onCheckedChange}
			/>
			<span className="text-sm font-medium">{label}</span>
			<div
				className={
					checked
						? "flex flex-wrap items-center gap-2"
						: "flex flex-wrap items-center gap-2 opacity-50"
				}
			>
				{children}
			</div>
		</div>
	);
}

function MemberTypesField({
	value,
	onChange,
}: {
	value: ReminderSettings["nudgeMemberTypes"];
	onChange: (types: ReminderSettings["nudgeMemberTypes"]) => void;
}) {
	return (
		<FieldRow label="Who" hint="Overhead employees never get it.">
			<PillToggleGroup
				items={MEMBER_TYPE_ITEMS}
				selectedIds={value}
				onToggle={(id) =>
					// Rebuilt from the constant rather than appended to, so the stored
					// order never depends on the order of the clicks.
					onChange(
						MEMBER_TYPES.filter((type) =>
							type === id ? !value.includes(type) : value.includes(type),
						),
					)
				}
			/>
		</FieldRow>
	);
}

// "Who gets this today": the same selection the job runs, for any date, so an
// admin can see the effect of a setting before it messages anybody. It shows
// the saved settings, not the draft — the draft has not been checked by
// anything but this browser.
function PreviewDialog({ kind, title }: { kind: ReminderKind; title: string }) {
	const orgSlug = useOrgSlug();
	const { organization } = Route.useRouteContext();
	const [open, setOpen] = useState(false);
	// A one-off default for a date field. A stale day does no harm, because the
	// person can change the date.
	const [date, setDate] = useState(() =>
		dayKeyInTz(new Date(), organization.timezone),
	);
	const valid = isValidDayKey(date);
	const preview = useQuery({
		...reminderPreviewQuery(orgSlug, kind, date),
		enabled: open && valid,
	});
	const dateId = useId();

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger
				render={
					<Button variant="outline" size="sm">
						Who gets this today
					</Button>
				}
			/>
			<DialogContent className="sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>{title}: who gets it</DialogTitle>
					<DialogDescription>
						By the saved settings. The preview ignores the time of day and what
						already went out.
					</DialogDescription>
				</DialogHeader>
				<div className="flex items-center gap-2">
					<Label htmlFor={dateId}>Date</Label>
					<Input
						id={dateId}
						type="date"
						value={date}
						onChange={(e) => setDate(e.target.value)}
						className="w-44"
					/>
				</div>
				{!valid ? (
					<p className="text-sm text-muted-foreground">Pick a date.</p>
				) : preview.isPending ? (
					<p className="text-sm text-muted-foreground">Loading…</p>
				) : preview.isError ? (
					<p className="text-sm text-destructive">{preview.error.message}</p>
				) : (
					<PreviewBody preview={preview.data} />
				)}
			</DialogContent>
		</Dialog>
	);
}

function PreviewBody({ preview }: { preview: ReminderPreview }) {
	if (preview.skipped) {
		return <p className="text-sm text-muted-foreground">{preview.skipped}</p>;
	}
	const count = preview.recipients.length;
	return (
		<div className="flex flex-col gap-5 text-sm">
			<p className="text-muted-foreground">
				{preview.sendsAt
					? `Goes out at ${preview.sendsAt}`
					: "Goes out at the end of each person's workday"}{" "}
				to {count === 1 ? "1 person" : `${count} people`}.
			</p>
			{count > 0 && (
				<ul className="flex flex-col gap-3">
					{preview.recipients.map((person) => (
						<li key={person.userId} className="flex flex-col gap-1">
							<div className="flex flex-wrap items-baseline gap-2">
								<span className="font-medium">{person.name}</span>
								<span className="text-xs text-muted-foreground">
									{person.reason}
								</span>
							</div>
							<p className="rounded-md bg-muted px-3 py-2 text-xs whitespace-pre-line text-muted-foreground">
								{person.message}
							</p>
						</li>
					))}
				</ul>
			)}
			{preview.heldBack.length > 0 && (
				<div className="flex flex-col gap-2">
					<h3 className="eyebrow">Held back</h3>
					<ul className="flex flex-col gap-1">
						{preview.heldBack.map((person) => (
							<li key={person.userId} className="flex flex-wrap gap-2">
								<span className="font-medium">{person.name}</span>
								<span className="text-muted-foreground">{person.reason}</span>
							</li>
						))}
					</ul>
				</div>
			)}
		</div>
	);
}
