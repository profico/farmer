import {
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { ArchivedSection } from "#/components/archived-section.tsx";
import { InviteMemberDialog } from "#/components/invite-member-dialog.tsx";
import { PersonCell } from "#/components/person-avatar.tsx";
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
import { DatePicker } from "#/components/ui/date-picker.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Page, PageHeader } from "#/components/ui/page-header.tsx";
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
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import {
	membersQuery,
	pendingInvitationsQuery,
	peopleQuery,
} from "#/queries/members.ts";
import { requireOrgAdmin } from "#/server/auth.ts";
import {
	cancelInvitation,
	type listInvitations,
	removeMember,
	setMemberArchived,
	setMemberStartDate,
	setMemberType,
	updateMemberRole,
} from "#/server/members.ts";

const ROLE_ITEMS = [
	{ value: "member", label: "Member" },
	{ value: "admin", label: "Admin" },
] as const;

// Person type drives who the compliance report, Slack reminders and utilization
// apply to. Changing it is effective-dated so a past month keeps reporting the
// type the person actually held then.
const TYPE_ITEMS = [
	{ value: "billable", label: "Billable" },
	{ value: "overhead", label: "Overhead" },
	{ value: "contractor", label: "Contractor" },
] as const;

const searchSchema = z.object({
	archived: z.literal("1").optional(),
});

const MEMBER_COLUMN_COUNT = 7;

export const Route = createFileRoute("/$orgSlug/settings/members")({
	validateSearch: searchSchema,
	beforeLoad: async () => {
		await requireOrgAdmin();
	},
	loader: async ({ context, params }) => {
		const orgSlug = params.orgSlug;
		await Promise.all([
			context.queryClient.ensureQueryData(membersQuery(orgSlug)),
			context.queryClient.ensureQueryData(peopleQuery(orgSlug)),
			context.queryClient.ensureQueryData(pendingInvitationsQuery(orgSlug)),
		]);
	},
	component: MembersSettingsPage,
});

function MembersSettingsPage() {
	const orgSlug = useOrgSlug();
	const { session } = Route.useRouteContext();
	const { data: membersData } = useSuspenseQuery(membersQuery(orgSlug));
	const { data: people } = useSuspenseQuery(peopleQuery(orgSlug));
	const personByUserId = new Map(people.map((p) => [p.userId, p]));
	const { data: invitations } = useSuspenseQuery(
		pendingInvitationsQuery(orgSlug),
	);
	const queryClient = useQueryClient();
	const search = Route.useSearch();
	const navigate = Route.useNavigate();

	const owners = membersData.members.filter((m) => m.role === "owner");

	const invalidate = () =>
		Promise.all([
			queryClient.invalidateQueries({
				queryKey: membersQuery(orgSlug).queryKey,
			}),
			queryClient.invalidateQueries({
				queryKey: peopleQuery(orgSlug).queryKey,
			}),
			queryClient.invalidateQueries({
				queryKey: pendingInvitationsQuery(orgSlug).queryKey,
			}),
		]);

	const roleMutation = useMutation({
		mutationFn: (vars: { memberId: string; role: "admin" | "member" }) =>
			updateMemberRole({ data: vars }),
		onSuccess: invalidate,
		onError: (error) => toast.error(error.message ?? "Could not update role"),
	});

	const removeMutation = useMutation({
		mutationFn: (memberId: string) => removeMember({ data: memberId }),
		onSuccess: invalidate,
		onError: (error) => toast.error(error.message ?? "Could not remove member"),
	});

	// Effective from today: the common real change is a contractor becoming an
	// employee, and it takes effect now, not retroactively.
	const typeMutation = useMutation({
		mutationFn: (vars: {
			userId: string;
			type: "billable" | "overhead" | "contractor";
			expectedSecondsOverride?: number | null;
		}) =>
			setMemberType({
				data: {
					...vars,
					effectiveFrom: new Date().toISOString().slice(0, 10),
				},
			}),
		onSuccess: invalidate,
		onError: (error) => toast.error(error.message ?? "Could not update type"),
	});

	const archiveMutation = useMutation({
		mutationFn: (vars: { userId: string; archived: boolean }) =>
			setMemberArchived({ data: vars }),
		onSuccess: (result) => {
			if (result.emailConfirmed) toast.success("Restored, address confirmed");
			return invalidate();
		},
		onError: (error) => toast.error(error.message ?? "Could not archive"),
	});

	// A person an import made with a guessed address, who has never signed in.
	// Restoring them confirms the address, so whoever signs in with Google as
	// it becomes this person — the admin looks at it first.
	const [confirmRestore, setConfirmRestore] = useState<{
		userId: string;
		name: string;
		email: string;
	} | null>(null);

	const startDateMutation = useMutation({
		mutationFn: (vars: { userId: string; startDate: string | null }) =>
			setMemberStartDate({ data: vars }),
		onSuccess: invalidate,
		onError: (error) =>
			toast.error(error.message ?? "Could not update start date"),
	});

	const cancelMutation = useMutation({
		mutationFn: (invitationId: string) =>
			cancelInvitation({ data: invitationId }),
		onSuccess: invalidate,
		onError: (error) =>
			toast.error(error.message ?? "Could not cancel invitation"),
	});

	// Archived people move into the closed-by-default section below rather
	// than disappearing — you need to see who has left to restore them, and
	// the section keeps Restore one click away.
	const activeMembers = membersData.members.filter(
		(m) => personByUserId.get(m.userId)?.archivedAt == null,
	);
	const archivedMembers = membersData.members.filter(
		(m) => personByUserId.get(m.userId)?.archivedAt != null,
	);

	const renderMemberRow = (m: (typeof membersData.members)[number]) => {
		const isSelf = m.userId === session.user.id;
		const isOnlyOwner = m.role === "owner" && owners.length <= 1;
		const person = personByUserId.get(m.userId);
		const type = person?.type ?? "billable";
		const archived = person?.archivedAt != null;
		return (
			<TableRow key={m.id}>
				<TableCell>
					<PersonCell userId={m.userId} name={m.user.name}>
						{archived && (
							<span className="block text-2xs text-muted-foreground">
								Archived
							</span>
						)}
					</PersonCell>
				</TableCell>
				<TableCell>{m.user.email}</TableCell>
				<TableCell>
					<Select
						value={type}
						onValueChange={(next) => {
							// Resolved against the list the Select was built from,
							// so the union comes from the options rather than from
							// an assertion about what the widget handed back.
							const picked = TYPE_ITEMS.find((option) => option.value === next);
							if (!picked) return;
							typeMutation.mutate({
								userId: m.userId,
								type: picked.value,
								// The override only applies to contractors, and the
								// input rejects it for anyone else — so switching a
								// contractor to billable drops it rather than failing
								// validation on a field the row no longer shows.
								expectedSecondsOverride:
									picked.value === "contractor"
										? (person?.expectedSecondsOverride ?? null)
										: null,
							});
						}}
						disabled={typeMutation.isPending}
						items={TYPE_ITEMS}
					>
						<SelectTrigger className="h-7 w-32 text-xs">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{TYPE_ITEMS.map((opt) => (
								<SelectItem key={opt.value} value={opt.value}>
									{opt.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</TableCell>
				<TableCell>
					<ExpectedHoursCell
						type={type}
						expectedSecondsOverride={person?.expectedSecondsOverride ?? null}
						onCommit={(expectedSecondsOverride) =>
							typeMutation.mutate({
								userId: m.userId,
								type: "contractor",
								expectedSecondsOverride,
							})
						}
					/>
				</TableCell>
				<TableCell>
					<StartDateCell
						startDate={person?.startDate ?? null}
						onCommit={(startDate) =>
							startDateMutation.mutate({ userId: m.userId, startDate })
						}
					/>
				</TableCell>
				<TableCell>
					{m.role === "owner" ? (
						<span className="text-sm text-muted-foreground">Owner</span>
					) : (
						<Select
							value={m.role}
							onValueChange={(role) => {
								const picked = ROLE_ITEMS.find(
									(option) => option.value === role,
								);
								if (!picked) return;
								roleMutation.mutate({
									memberId: m.id,
									role: picked.value,
								});
							}}
							disabled={isSelf || roleMutation.isPending}
							items={ROLE_ITEMS}
						>
							<SelectTrigger className="h-7 w-28 text-xs">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{ROLE_ITEMS.map((opt) => (
									<SelectItem key={opt.value} value={opt.value}>
										{opt.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					)}
				</TableCell>
				<TableCell>
					{/* Archive, not delete: an archived person keeps every
					    entry, close row and finalized month they appear in and
					    drops out of the forward-looking surfaces. Remove is
					    still here for the invited-the-wrong-address case, but
					    it is no longer the obvious button. */}
					{!isSelf && !isOnlyOwner && (
						<div className="flex justify-end gap-2">
							<Button
								variant="outline"
								size="sm"
								disabled={archiveMutation.isPending}
								onClick={() => {
									if (archived && person?.emailUnconfirmed) {
										setConfirmRestore({
											userId: m.userId,
											name: m.user.name,
											email: m.user.email,
										});
										return;
									}
									archiveMutation.mutate({
										userId: m.userId,
										archived: !archived,
									});
								}}
							>
								{archived ? "Restore" : "Archive"}
							</Button>
							<Button
								variant="ghost"
								size="sm"
								disabled={removeMutation.isPending}
								onClick={() => removeMutation.mutate(m.id)}
							>
								Remove
							</Button>
						</div>
					)}
				</TableCell>
			</TableRow>
		);
	};

	return (
		<Page>
			<PageHeader
				eyebrow={<SettingsEyebrow>Workspace</SettingsEyebrow>}
				title="People"
				lede="Who has access, and what kind of person they are. Overhead people are left out of compliance nudges and utilization; contractors have no Expected hours unless you give them one. Archive someone who has left — their entries and closed months stay exactly as they were."
				action={<InviteMemberDialog />}
			/>

			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Name</TableHead>
						<TableHead>Email</TableHead>
						<TableHead>Type</TableHead>
						<TableHead>Expected</TableHead>
						<TableHead>Started</TableHead>
						<TableHead>Access</TableHead>
						<TableHead />
					</TableRow>
				</TableHeader>
				<TableBody>
					{activeMembers.map(renderMemberRow)}
					<ArchivedSection
						count={archivedMembers.length}
						colSpan={MEMBER_COLUMN_COUNT}
						open={search.archived === "1"}
						onOpenChange={(open) =>
							navigate({ search: { archived: open ? "1" : undefined } })
						}
					>
						{archivedMembers.map(renderMemberRow)}
					</ArchivedSection>
				</TableBody>
			</Table>

			<AlertDialog
				open={confirmRestore != null}
				onOpenChange={(open) => {
					if (!open) setConfirmRestore(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Restore {confirmRestore?.name}?</AlertDialogTitle>
						<AlertDialogDescription>
							They have never signed in, and nobody has confirmed their address.
							Restoring them confirms{" "}
							<strong className="text-foreground">
								{confirmRestore?.email}
							</strong>
							: whoever signs in with Google as that address becomes this
							person. Check it first.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							disabled={archiveMutation.isPending}
							onClick={() => {
								if (!confirmRestore) return;
								archiveMutation.mutate(
									{ userId: confirmRestore.userId, archived: false },
									{ onSettled: () => setConfirmRestore(null) },
								);
							}}
						>
							Restore and confirm
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			{invitations.length > 0 && (
				<div className="mt-8">
					<h2 className="eyebrow">Pending invitations</h2>
					<Table containerClassName="mt-3">
						<TableHeader>
							<TableRow>
								<TableHead>Email</TableHead>
								<TableHead>Role</TableHead>
								<TableHead />
							</TableRow>
						</TableHeader>
						<TableBody>
							{invitations.map((inv) => (
								<TableRow key={inv.id}>
									<TableCell className="font-medium">
										<span className="flex items-center gap-2">
											{inv.email}
											<InvitationEmailBadge delivery={inv.emailDelivery} />
										</span>
									</TableCell>
									<TableCell className="capitalize">{inv.role}</TableCell>
									<TableCell>
										<Button
											variant="ghost"
											size="sm"
											disabled={cancelMutation.isPending}
											onClick={() => cancelMutation.mutate(inv.id)}
										>
											Cancel
										</Button>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			)}
		</Page>
	);
}

type PendingInvitation = Awaited<ReturnType<typeof listInvitations>>[number];

/**
 * Whether the invitation email left. Nothing for an invitation made before
 * delivery was tracked: there is nothing true to say about it. A failure's
 * reason is the provider's own message, on hover.
 */
function InvitationEmailBadge({
	delivery,
}: {
	delivery: PendingInvitation["emailDelivery"];
}) {
	if (!delivery) return null;
	if (delivery.status === "sending")
		return <Badge variant="outline">Sending…</Badge>;
	if (delivery.status === "sent")
		return <Badge variant="secondary">Email sent</Badge>;
	return (
		<Badge variant="destructive" title={delivery.error ?? undefined}>
			Email failed
		</Badge>
	);
}

/**
 * A contractor's explicit monthly Expected figure (PRD 3.1), in hours.
 *
 * Only contractors have one. Everybody else derives Expected from the org's
 * monthly hour fund, so the cell reads as a dash rather than an empty input —
 * an empty box invites you to type a number that would be rejected.
 *
 * Blank means "no Expected at all": the "/" rows of the old PM sheet, where a
 * contractor shows Reported/Adjusted/Final and no pace or utilization
 * percentage.
 */
function ExpectedHoursCell({
	type,
	expectedSecondsOverride,
	onCommit,
}: {
	type: string;
	expectedSecondsOverride: number | null;
	onCommit: (expectedSecondsOverride: number | null) => void;
}) {
	const asHours =
		expectedSecondsOverride == null
			? ""
			: String(Math.round((expectedSecondsOverride / 3600) * 100) / 100);
	const [value, setValue] = useState(asHours);
	useEffect(() => {
		setValue(asHours);
	}, [asHours]);

	if (type !== "contractor") {
		return <span className="text-sm text-faint">—</span>;
	}

	return (
		<Input
			type="number"
			min={0}
			step={0.25}
			placeholder="—"
			className="h-7 w-24 text-xs"
			value={value}
			onChange={(e) => setValue(e.target.value)}
			onBlur={() => {
				const trimmed = value.trim();
				const parsed = trimmed === "" ? null : Number(trimmed);
				if (parsed != null && (!Number.isFinite(parsed) || parsed < 0)) {
					setValue(asHours);
					return;
				}
				const seconds = parsed == null ? null : Math.round(parsed * 3600);
				if (seconds === expectedSecondsOverride) return;
				onCommit(seconds);
			}}
		/>
	);
}

// A start date can legitimately be unset, so this is the one picker in the app
// with a clear button. It commits on pick rather than on blur: picking a day in
// the calendar closes the popover, which is an unambiguous "done" — the local
// draft state the text input needed (and the effect that resynced it after a
// refetch) has nothing left to do.
function StartDateCell({
	startDate,
	onCommit,
}: {
	startDate: string | null;
	onCommit: (startDate: string | null) => void;
}) {
	return (
		<DatePicker
			aria-label="Start date"
			className="h-7 w-36 text-xs"
			placeholder="Not set"
			clearable
			value={startDate}
			onValueChange={(next) => {
				if (next !== startDate) onCommit(next);
			}}
		/>
	);
}
