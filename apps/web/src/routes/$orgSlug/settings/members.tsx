import {
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { InviteMemberDialog } from "#/components/invite-member-dialog.tsx";
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
import { cn } from "#/lib/utils.ts";
import {
	membersQuery,
	pendingInvitationsQuery,
	peopleQuery,
} from "#/queries/members.ts";
import { requireOrgAdmin } from "#/server/auth.ts";
import {
	cancelInvitation,
	removeMember,
	setMemberArchived,
	setMemberStartDate,
	setMemberType,
	updateMemberRole,
} from "#/server/members.ts";

const ROLE_ITEMS = [
	{ value: "member", label: "Member" },
	{ value: "admin", label: "Admin" },
];

// Person type drives who the compliance report, Slack reminders and utilization
// apply to. Changing it is effective-dated so a past month keeps reporting the
// type the person actually held then.
const TYPE_ITEMS = [
	{ value: "billable", label: "Billable" },
	{ value: "overhead", label: "Overhead" },
	{ value: "contractor", label: "Contractor" },
];

export const Route = createFileRoute("/$orgSlug/settings/members")({
	beforeLoad: async () => {
		await requireOrgAdmin();
	},
	loader: async ({ context }) => {
		await Promise.all([
			context.queryClient.ensureQueryData(membersQuery()),
			context.queryClient.ensureQueryData(peopleQuery()),
			context.queryClient.ensureQueryData(pendingInvitationsQuery()),
		]);
	},
	component: MembersSettingsPage,
});

function MembersSettingsPage() {
	const { session } = Route.useRouteContext();
	const { data: membersData } = useSuspenseQuery(membersQuery());
	const { data: people } = useSuspenseQuery(peopleQuery());
	const personByUserId = new Map(people.map((p) => [p.userId, p]));
	const { data: invitations } = useSuspenseQuery(pendingInvitationsQuery());
	const queryClient = useQueryClient();

	const owners = membersData.members.filter((m) => m.role === "owner");

	const invalidate = () =>
		Promise.all([
			queryClient.invalidateQueries({ queryKey: membersQuery().queryKey }),
			queryClient.invalidateQueries({ queryKey: peopleQuery().queryKey }),
			queryClient.invalidateQueries({
				queryKey: pendingInvitationsQuery().queryKey,
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
		onSuccess: invalidate,
		onError: (error) => toast.error(error.message ?? "Could not archive"),
	});

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

	return (
		<Page className="screen">
			<PageHeader
				eyebrow="Workspace"
				title="People"
				lede="Who has access, and what kind of person they are. Overhead people are left out of compliance nudges and utilization; contractors have no Expected hours unless you give them one. Archive someone who has left — their entries and closed months stay exactly as they were."
				action={<InviteMemberDialog />}
				className="mb-0"
			/>

			<Table containerClassName="mt-6">
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
					{membersData.members.map((m) => {
						const isSelf = m.userId === session.user.id;
						const isOnlyOwner = m.role === "owner" && owners.length <= 1;
						const person = personByUserId.get(m.userId);
						const type = person?.type ?? "billable";
						const archived = person?.archivedAt != null;
						return (
							// Archived people stay in the list rather than disappearing —
							// you need to see who has left to restore them, and a hidden
							// row is a row nobody can undo.
							<TableRow key={m.id} className={cn(archived && "opacity-55")}>
								<TableCell className="font-medium">
									{m.user.name}
									{archived && (
										<span className="ml-2 text-2xs text-muted-foreground">
											Archived
										</span>
									)}
								</TableCell>
								<TableCell>{m.user.email}</TableCell>
								<TableCell>
									<Select
										value={type}
										onValueChange={(next) =>
											next &&
											typeMutation.mutate({
												userId: m.userId,
												type: next as "billable" | "overhead" | "contractor",
												// The override only applies to contractors, and the
												// input rejects it for anyone else — so switching a
												// contractor to billable drops it rather than failing
												// validation on a field the row no longer shows.
												expectedSecondsOverride:
													next === "contractor"
														? (person?.expectedSecondsOverride ?? null)
														: null,
											})
										}
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
										expectedSecondsOverride={
											person?.expectedSecondsOverride ?? null
										}
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
											onValueChange={(role) =>
												role &&
												roleMutation.mutate({
													memberId: m.id,
													role: role as "admin" | "member",
												})
											}
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
												onClick={() =>
													archiveMutation.mutate({
														userId: m.userId,
														archived: !archived,
													})
												}
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
					})}
				</TableBody>
			</Table>

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
									<TableCell className="font-medium">{inv.email}</TableCell>
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
