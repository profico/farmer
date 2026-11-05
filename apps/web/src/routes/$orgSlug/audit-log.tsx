import {
	AUDIT_KINDS,
	AUDIT_RETENTION_DAYS,
	AUDIT_RETENTION_LABELS,
	type AuditCategory,
	type AuditChanges,
	type AuditRetentionDays,
	type AuditValue,
	auditViaLabel,
	describeAuditEvent,
	isAuditKind,
} from "@farmer/core/lib/audit";
import type { JsonRecord, JsonValue } from "@farmer/core/lib/json";
import type { AuditFilterInput } from "@farmer/core/schema";
import {
	ArrowRightIcon,
	CaretDownIcon,
	CaretRightIcon,
} from "@phosphor-icons/react";
import {
	useInfiniteQuery,
	useMutation,
	useQuery,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useState } from "react";
import { toast } from "sonner";

import { PersonAvatar } from "#/components/person-avatar.tsx";
import { StatusPill } from "#/components/status-pill.tsx";
import { Button } from "#/components/ui/button.tsx";
import { DatePicker } from "#/components/ui/date-picker.tsx";
import { Page, PageHeader, PageSection } from "#/components/ui/page-header.tsx";
import {
	SegmentedControl,
	SegmentedControlItem,
} from "#/components/ui/segmented-control.tsx";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select.tsx";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table.tsx";
import { When } from "#/components/when.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { auditEventsQuery, auditRetentionQuery } from "#/queries/audit.ts";
import { queryKeys } from "#/queries/keys.ts";
import { directoryQuery } from "#/queries/members.ts";
import { exportAuditEvents, setAuditRetention } from "#/server/audit.ts";
import { requireOrgAdmin } from "#/server/auth.ts";

// Audit log (issue #112): who changed what in this workspace, and
// every sign-in of its people. Admin only. What is recorded, and what is not,
// is in `docs/domains/audit-log.md`.

export const Route = createFileRoute("/$orgSlug/audit-log")({
	beforeLoad: async () => {
		await requireOrgAdmin();
	},
	loader: async ({ context, params }) => {
		await Promise.all([
			context.queryClient.ensureInfiniteQueryData(
				auditEventsQuery(params.orgSlug, {}),
			),
			context.queryClient.ensureQueryData(auditRetentionQuery(params.orgSlug)),
		]);
	},
	component: AuditLogPage,
});

const CATEGORY_TABS: { value: AuditCategory | null; label: string }[] = [
	{ value: null, label: "Everything" },
	{ value: "change", label: "Changes" },
	{ value: "security", label: "Security" },
];

const EVERYONE = "everyone";

const RETENTION_ITEMS = AUDIT_RETENTION_DAYS.map((days) => ({
	value: String(days),
	label: AUDIT_RETENTION_LABELS[days],
}));

const toRetention = (value: string): AuditRetentionDays | null =>
	AUDIT_RETENTION_DAYS.find((days) => String(days) === value) ?? null;

const formatValue = (value: AuditValue): string => {
	if (value === null || value === "") return "—";
	if (Array.isArray(value)) return value.length ? value.join(", ") : "—";
	if (value === true) return "On";
	if (value === false) return "Off";
	return String(value);
};

/** A detail as text: a number or a string as it is, anything larger as JSON. */
const detailText = (value: JsonValue): string => {
	if (value === null) return "—";
	return value instanceof Object ? JSON.stringify(value) : String(value);
};

/** `trackingTolerancePct` → "Tracking tolerance pct". */
const fieldLabel = (field: string) => {
	const words = field
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replaceAll("_", " ")
		.toLowerCase();
	return words.charAt(0).toUpperCase() + words.slice(1);
};

/** Today in the browser, as a day key: the default end of an export. */
const todayKey = () => new Date().toLocaleDateString("en-CA");

const daysBefore = (key: string, days: number) => {
	const date = new Date(`${key}T12:00:00`);
	date.setDate(date.getDate() - days);
	return date.toLocaleDateString("en-CA");
};

const download = (csv: string, name: string) => {
	const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
	const link = document.createElement("a");
	link.href = url;
	link.download = name;
	link.click();
	URL.revokeObjectURL(url);
};

function AuditLogPage() {
	const orgSlug = useOrgSlug();
	const queryClient = useQueryClient();

	const [category, setCategory] = useState<AuditCategory | null>(null);
	const [userId, setUserId] = useState<string | null>(null);
	const [from, setFrom] = useState<string | null>(null);
	const [to, setTo] = useState<string | null>(null);
	const [open, setOpen] = useState<Set<string>>(new Set());

	// An unset filter is `undefined`, which the query key and the server
	// function both read as absent.
	const filter: AuditFilterInput = {
		category: category ?? undefined,
		userId: userId ?? undefined,
		from: from ?? undefined,
		to: to ?? undefined,
	};

	const events = useInfiniteQuery(auditEventsQuery(orgSlug, filter));
	const { data: retention } = useSuspenseQuery(auditRetentionQuery(orgSlug));
	const { data: directory } = useQuery(directoryQuery(orgSlug));

	const people = [...(directory ?? [])].sort((a, b) =>
		a.name.localeCompare(b.name),
	);
	const personItems = [
		{ value: EVERYONE, label: "Everyone" },
		...people.map((person) => ({ value: person.userId, label: person.name })),
	];

	const rows = events.data?.pages.flatMap((page) => page.events) ?? [];

	const retain = useMutation({
		mutationFn: (days: AuditRetentionDays) =>
			setAuditRetention({ data: { days } }),
		onSuccess: () =>
			queryClient.invalidateQueries({
				queryKey: [...queryKeys(orgSlug).audit],
			}),
		onError: (error) => toast.error(error.message ?? "Could not save"),
	});

	const exporter = useMutation({
		mutationFn: () => {
			const end = to ?? todayKey();
			const start = from ?? daysBefore(end, 364);
			return exportAuditEvents({
				data: { ...filter, from: start, to: end },
			}).then((result) => ({ ...result, start, end }));
		},
		onSuccess: async (result) => {
			download(result.csv, `audit-log-${result.start}-${result.end}.csv`);
			if (result.truncated) {
				toast.warning(
					`The export holds the newest ${String(result.rows)} rows. Pick a shorter range for the rest.`,
				);
			}
			// The export records itself, so the log has a new row at the top.
			await queryClient.invalidateQueries({
				queryKey: [...queryKeys(orgSlug).audit, "events"],
			});
		},
		onError: (error) => toast.error(error.message ?? "Could not export"),
	});

	const toggle = (id: string) =>
		setOpen((current) => {
			const next = new Set(current);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});

	return (
		<Page>
			<PageHeader
				title="Audit log"
				lede={`Who changed what in this workspace, and every sign-in of its people. Kept for ${AUDIT_RETENTION_LABELS[retention]}.`}
				action={
					<Button
						variant="outline"
						disabled={exporter.isPending}
						onClick={() => exporter.mutate()}
					>
						Export CSV
					</Button>
				}
			/>

			<PageSection>
				<div className="flex flex-wrap items-end gap-3">
					<SegmentedControl>
						{CATEGORY_TABS.map((tab) => (
							<SegmentedControlItem
								key={tab.label}
								active={category === tab.value}
								onClick={() => setCategory(tab.value)}
							>
								{tab.label}
							</SegmentedControlItem>
						))}
					</SegmentedControl>
					<Select
						value={userId ?? EVERYONE}
						onValueChange={(value) =>
							setUserId(!value || value === EVERYONE ? null : value)
						}
						items={personItems}
					>
						<SelectTrigger className="w-56 bg-card" aria-label="Person">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{personItems.map((item) => (
								<SelectItem key={item.value} value={item.value}>
									{item.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<DatePicker
						className="w-44"
						value={from}
						onValueChange={setFrom}
						max={to ?? undefined}
						placeholder="From"
						aria-label="From"
						clearable
					/>
					<DatePicker
						className="w-44"
						value={to}
						onValueChange={setTo}
						min={from ?? undefined}
						placeholder="To"
						aria-label="To"
						clearable
					/>
				</div>
			</PageSection>

			<PageSection>
				{events.isPending ? (
					<p className="text-sm text-muted-foreground">Loading…</p>
				) : rows.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						Nothing recorded for this filter.
					</p>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead className="w-8" />
								<TableHead>When</TableHead>
								<TableHead>What</TableHead>
								<TableHead>Via</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{rows.map((event) => {
								const expanded = open.has(event.id);
								const sentence = describeAuditEvent(
									event.kind,
									event.targetLabel,
									event.actorUserId !== null &&
										event.actorUserId === event.subjectUserId,
								);
								const security =
									isAuditKind(event.kind) &&
									AUDIT_KINDS[event.kind].category === "security";
								return (
									<Fragment key={event.id}>
										<TableRow>
											<TableCell>
												<Button
													variant="ghost"
													size="icon-sm"
													aria-label={
														expanded ? "Hide details" : "Show details"
													}
													aria-expanded={expanded}
													onClick={() => toggle(event.id)}
												>
													{expanded ? <CaretDownIcon /> : <CaretRightIcon />}
												</Button>
											</TableCell>
											<TableCell className="tnum whitespace-nowrap text-muted-foreground">
												<When date={event.occurredAt} />
											</TableCell>
											<TableCell>
												<div className="flex items-center gap-2">
													{event.actorName ? (
														<PersonAvatar
															name={event.actorName}
															userId={event.actorUserId ?? undefined}
															size="sm"
														/>
													) : null}
													<span>
														<span className="font-medium">
															{event.actorName ?? "Someone"}
														</span>{" "}
														{sentence}
														{event.impersonatorName ? (
															<span className="text-muted-foreground">
																{" "}
																(impersonated by {event.impersonatorName})
															</span>
														) : null}
													</span>
													{security ? (
														<StatusPill tone="warning">Security</StatusPill>
													) : null}
												</div>
											</TableCell>
											<TableCell className="text-muted-foreground">
												{auditViaLabel(event.via)}
											</TableCell>
										</TableRow>
										{expanded ? (
											<TableRow>
												<TableCell />
												<TableCell colSpan={3}>
													<EventDetails
														changes={event.changes}
														details={event.details}
														ip={event.ip}
														userAgent={event.userAgent}
														kind={event.kind}
													/>
												</TableCell>
											</TableRow>
										) : null}
									</Fragment>
								);
							})}
						</TableBody>
					</Table>
				)}
				{events.hasNextPage ? (
					<div className="mt-4 flex justify-center">
						<Button
							variant="outline"
							disabled={events.isFetchingNextPage}
							onClick={() => void events.fetchNextPage()}
						>
							Show older
						</Button>
					</div>
				) : null}
			</PageSection>

			<PageSection
				title="Retention"
				description="Older entries are deleted once a day. A shorter period deletes the older entries at the next sweep."
			>
				<Select
					value={String(retention)}
					onValueChange={(value) => {
						const days = value ? toRetention(value) : null;
						if (days) retain.mutate(days);
					}}
					disabled={retain.isPending}
					items={RETENTION_ITEMS}
				>
					<SelectTrigger className="w-full max-w-sm bg-card">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{RETENTION_ITEMS.map((item) => (
							<SelectItem key={item.value} value={item.value}>
								{item.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</PageSection>
		</Page>
	);
}

function EventDetails({
	kind,
	changes,
	details,
	ip,
	userAgent,
}: {
	kind: string;
	changes: AuditChanges | null;
	details: JsonRecord | null;
	ip: string | null;
	userAgent: string | null;
}) {
	const changed = Object.entries(changes ?? {});
	const extra = Object.entries(details ?? {});
	return (
		<dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
			{changed.map(([field, change]) => (
				<Fragment key={field}>
					<dt className="text-muted-foreground">{fieldLabel(field)}</dt>
					<dd>
						<span className="text-muted-foreground line-through">
							{formatValue(change.from)}
						</span>
						<ArrowRightIcon
							aria-label="to"
							className="mx-1.5 inline size-3.5 align-[-0.15em] text-muted-foreground"
						/>
						{formatValue(change.to)}
					</dd>
				</Fragment>
			))}
			{extra.map(([key, value]) => (
				<Fragment key={key}>
					<dt className="text-muted-foreground">{fieldLabel(key)}</dt>
					<dd className="break-all">{detailText(value)}</dd>
				</Fragment>
			))}
			{ip ? (
				<>
					<dt className="text-muted-foreground">IP address</dt>
					<dd className="font-mono text-xs">{ip}</dd>
				</>
			) : null}
			{userAgent ? (
				<>
					<dt className="text-muted-foreground">Browser</dt>
					<dd className="text-xs break-all">{userAgent}</dd>
				</>
			) : null}
			<dt className="text-muted-foreground">Event</dt>
			<dd className="font-mono text-xs">{kind}</dd>
		</dl>
	);
}
