import { matchesSearch } from "@farmer/core/lib/search";
import {
	isHourlyMemberType,
	MEMBER_TYPE_LABELS,
	memberTypeEnum,
	type MemberTypeValue,
} from "@farmer/core/schema";
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
import { TeamLeadPeopleDialog } from "#/components/team-lead-people-dialog.tsx";
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
import { PageFull, PageHeader } from "#/components/ui/page-header.tsx";
import { NoMatchesRow, SearchInput } from "#/components/ui/search-input.tsx";
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
	TableScroll,
} from "#/components/ui/table.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { startImpersonating } from "#/lib/impersonation.ts";
import { searchFlag } from "#/lib/search-flag.ts";
import { queryKeys } from "#/queries/keys.ts";
import {
	membersQuery,
	pendingInvitationsQuery,
	peopleQuery,
} from "#/queries/members.ts";
import { requireOrgAdmin } from "#/server/auth.ts";
import {
	cancelInvitation,
	confirmMemberEmail,
	type listInvitations,
	removeMember,
	resendInvitation,
	setMemberArchived,
	setMemberStartDate,
	setMemberType,
	updateMemberRole,
} from "#/server/members.ts";

const ROLE_ITEMS = [
	{ value: "member", label: "Member" },
	{ value: "admin", label: "Admin" },
] as const;

// Person type drives who the compliance report and Slack reminders apply to. Changing it is effective-dated so a past month keeps reporting the
// type the person actually held then.
const TYPE_ITEMS = memberTypeEnum.options.map((value) => ({
	value,
	label: MEMBER_TYPE_LABELS[value],
}));

const searchSchema = z.object({
	archived: searchFlag,
});

const MEMBER_COLUMN_COUNT = 8;

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
	const { session, isPlatformAdmin, impersonating } = Route.useRouteContext();
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
			// A person's type decides who Tracking and the reminders cover, so a
			// change here would otherwise show on Reports only after a reload.
			queryClient.invalidateQueries({
				queryKey: queryKeys(orgSlug).compliance,
			}),
			queryClient.invalidateQueries({ queryKey: queryKeys(orgSlug).reports }),
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

	// Effective from today: the common real change is a student or contractor
	// becoming an employee, and it takes effect now, not retroactively.
	const typeMutation = useMutation({
		mutationFn: (vars: {
			userId: string;
			type: MemberTypeValue;
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

	// Confirming the address of an active person who has never signed in. Not
	// only Restore: an import can make a person active with an address nobody
	// confirmed, and archiving them just to restore them was the only way out.
	const confirmMutation = useMutation({
		mutationFn: (userId: string) => confirmMemberEmail({ data: userId }),
		onSuccess: () => {
			toast.success("Address confirmed");
			return invalidate();
		},
		onError: (error) =>
			toast.error(error.message ?? "Could not confirm the address"),
	});

	// A person an import made with a guessed address, who has never signed in.
	// Restoring them, or confirming them while active, confirms the address, so
	// whoever signs in with Google as it becomes this person — the admin looks
	// at it first.
	const [confirmEmail, setConfirmEmail] = useState<{
		userId: string;
		name: string;
		email: string;
		restore: boolean;
	} | null>(null);

	// Becoming somebody else, for whoever operates the deployment. Not a role in
	// this workspace — see `packages/core/src/lib/platform-admin.ts` — so an org
	// admin never sees this button, however much of the rest of the page they own.
	//
	// No confirmation dialog. The row names the person, the button names the act,
	// and what follows is a whole application that says "Impersonating <name>" in
	// the sidebar until you stop; a modal in front of that would be a second
	// reading of a sentence you have already read. Nothing is written by the act
	// itself.
	const impersonateMutation = useMutation({
		mutationFn: (userId: string) => startImpersonating(userId),
		onError: (error) => toast.error(error.message ?? "Could not impersonate"),
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

	// Sends the email and the Slack DM again, and moves the expiry forward. The
	// email badge goes back to "Sending…" on the refetch.
	const resendMutation = useMutation({
		mutationFn: (invitationId: string) =>
			resendInvitation({ data: invitationId }),
		onSuccess: () => {
			toast.success("Invitation sent again");
			return invalidate();
		},
		onError: (error) =>
			toast.error(error.message ?? "Could not resend invitation"),
	});

	// Archived people move into the closed-by-default section below rather
	// than disappearing — you need to see who has left to restore them, and
	// the section keeps Restore one click away.
	const [query, setQuery] = useState("");
	const searching = query.trim() !== "";
	const matching = membersData.members.filter((m) =>
		matchesSearch(query, [m.user.name, m.user.email]),
	);
	const activeMembers = matching.filter(
		(m) => personByUserId.get(m.userId)?.archivedAt == null,
	);
	const archivedMembers = matching.filter(
		(m) => personByUserId.get(m.userId)?.archivedAt != null,
	);
	// A search that only turns up archived people opens their section rather
	// than reading as no result at all — the same rule as Projects.
	const archivedOpen =
		search.archived === "1" ||
		(searching && activeMembers.length === 0 && archivedMembers.length > 0);
	// One box for the page, so it narrows the invitations too: somebody looking
	// for an address should find it whether or not the person has accepted yet.
	const shownInvitations = invitations.filter((inv) =>
		matchesSearch(query, [inv.email]),
	);

	// Not while already impersonating. better-auth keeps the operator's own
	// session in a second cookie and `stopImpersonating` restores it, so a second
	// hop would overwrite that cookie and strand the way back — the operator
	// would have to sign out and in again to be themselves. One hop, then Stop.
	const canImpersonate = isPlatformAdmin && impersonating === null;

	const renderMemberRow = (m: (typeof membersData.members)[number]) => {
		const isSelf = m.userId === session.user.id;
		const isOnlyOwner = m.role === "owner" && owners.length <= 1;
		const person = personByUserId.get(m.userId);
		const type = person?.type ?? "employee_billable";
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
						{!archived && person?.claimPending && (
							<span
								className="block text-2xs text-muted-foreground"
								title="A Harvest import added this person. They can open the workspace once they join it on their first sign-in."
							>
								Not joined yet
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
								// The override only applies to hourly people, and the
								// input rejects it for anyone else — so switching an
								// hourly person to full-time drops it rather than failing
								// validation on a field the row no longer shows.
								expectedSecondsOverride: isHourlyMemberType(picked.value)
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
								type,
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
					{/* The Team Lead role lives here and nowhere else: people on the
					    list, or nobody. Archived people lead nobody. */}
					{archived ? (
						<span className="text-sm text-muted-foreground">—</span>
					) : (
						<TeamLeadPeopleDialog
							lead={{ userId: m.userId, name: m.user.name }}
							people={people}
							trigger={
								<Button variant="ghost" size="sm" className="-ml-2">
									{person?.leadsPeople
										? `${person.leadsPeople} ${person.leadsPeople === 1 ? "person" : "people"}`
										: "Nobody"}
								</Button>
							}
						/>
					)}
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
					<div className="flex justify-end gap-2">
						{/* Outside the `!isOnlyOwner` gate below, and deliberately: that
						    gate protects the workspace from losing its last owner, and
						    impersonating somebody takes nothing away from them. The only
						    exclusion is yourself, which is not a button, it is the page
						    you are already on.

						    Still offered for an archived person: "why can this person not
						    log in any more" is exactly the question this answers.

						    The server refuses one case the row cannot see — impersonating
						    another platform admin — and the toast carries its message. */}
						{canImpersonate && !isSelf && (
							<Button
								variant="outline"
								size="sm"
								disabled={impersonateMutation.isPending}
								onClick={() => impersonateMutation.mutate(m.userId)}
							>
								Impersonate
							</Button>
						)}
						{/* Archive, not delete: an archived person keeps every
						    entry and month they appear in and
						    drops out of the forward-looking surfaces. Remove is
						    still here for the invited-the-wrong-address case, but
						    it is no longer the obvious button. */}
						{!isSelf && !isOnlyOwner && (
							<>
								{!archived && person?.emailUnconfirmed && (
									<Button
										variant="outline"
										size="sm"
										disabled={confirmMutation.isPending}
										onClick={() =>
											setConfirmEmail({
												userId: m.userId,
												name: m.user.name,
												email: m.user.email,
												restore: false,
											})
										}
									>
										Confirm email
									</Button>
								)}
								<Button
									variant="outline"
									size="sm"
									className={archived ? undefined : "hover:text-destructive"}
									disabled={archiveMutation.isPending}
									onClick={() => {
										if (archived && person?.emailUnconfirmed) {
											setConfirmEmail({
												userId: m.userId,
												name: m.user.name,
												email: m.user.email,
												restore: true,
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
									className="hover:text-destructive"
									disabled={removeMutation.isPending}
									onClick={() => removeMutation.mutate(m.id)}
								>
									Remove
								</Button>
							</>
						)}
					</div>
				</TableCell>
			</TableRow>
		);
	};

	return (
		<PageFull>
			<PageHeader
				eyebrow={<SettingsEyebrow />}
				title="People"
				className="shrink-0"
				lede="Overhead employees get no reminders. Hourly students and contractors have no Expected hours unless you set them. Archived people keep their entries."
				action={
					<div className="flex items-center gap-2">
						<SearchInput
							value={query}
							onValueChange={setQuery}
							placeholder="Search people…"
							className="flex-1 sm:w-56 sm:flex-none"
						/>
						<InviteMemberDialog />
					</div>
				}
			/>

			<TableScroll>
				<Table bleed={false} stickyHeader containerClassName="border-b">
					<TableHeader>
						<TableRow>
							<TableHead>Name</TableHead>
							<TableHead>Email</TableHead>
							<TableHead>Type</TableHead>
							<TableHead>Expected</TableHead>
							<TableHead>Started</TableHead>
							<TableHead>Leads</TableHead>
							<TableHead>Access</TableHead>
							<TableHead />
						</TableRow>
					</TableHeader>
					<TableBody>
						{searching && activeMembers.length === 0 && (
							<NoMatchesRow colSpan={MEMBER_COLUMN_COUNT}>
								{archivedMembers.length > 0
									? "Only archived people match your search."
									: "Nobody matches your search."}
							</NoMatchesRow>
						)}
						{activeMembers.map(renderMemberRow)}
						<ArchivedSection
							count={archivedMembers.length}
							colSpan={MEMBER_COLUMN_COUNT}
							open={archivedOpen}
							sticky
							onOpenChange={(open) =>
								navigate({ search: { archived: open ? "1" : undefined } })
							}
						>
							{archivedMembers.map(renderMemberRow)}
						</ArchivedSection>
					</TableBody>
				</Table>

				{shownInvitations.length > 0 && (
					<div className="mt-8">
						<h2 className="eyebrow px-4 sm:px-8">Pending invitations</h2>
						<Table bleed={false} containerClassName="mt-3 border-y">
							<TableHeader>
								<TableRow>
									<TableHead>Email</TableHead>
									<TableHead>Role</TableHead>
									<TableHead />
								</TableRow>
							</TableHeader>
							<TableBody>
								{shownInvitations.map((inv) => (
									<TableRow key={inv.id}>
										<TableCell className="font-medium">
											<span className="flex items-center gap-2">
												{inv.email}
												<InvitationEmailBadge delivery={inv.emailDelivery} />
											</span>
										</TableCell>
										<TableCell className="capitalize">{inv.role}</TableCell>
										<TableCell>
											<div className="flex gap-1">
												<Button
													variant="ghost"
													size="sm"
													disabled={resendMutation.isPending}
													onClick={() => resendMutation.mutate(inv.id)}
												>
													Resend
												</Button>
												<Button
													variant="ghost"
													size="sm"
													className="hover:text-destructive"
													disabled={cancelMutation.isPending}
													onClick={() => cancelMutation.mutate(inv.id)}
												>
													Cancel
												</Button>
											</div>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
				)}
			</TableScroll>

			<AlertDialog
				open={confirmEmail != null}
				onOpenChange={(open) => {
					if (!open) setConfirmEmail(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{confirmEmail?.restore
								? `Restore ${confirmEmail.name}?`
								: `Confirm the address of ${confirmEmail?.name ?? ""}?`}
						</AlertDialogTitle>
						<AlertDialogDescription>
							They have never signed in, and nobody has confirmed their address.
							{confirmEmail?.restore
								? " Restoring them confirms "
								: " This confirms "}
							<strong className="text-foreground">{confirmEmail?.email}</strong>
							: whoever signs in with Google as that address becomes this
							person. Check it first.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							disabled={archiveMutation.isPending || confirmMutation.isPending}
							onClick={() => {
								if (!confirmEmail) return;
								const done = { onSettled: () => setConfirmEmail(null) };
								if (confirmEmail.restore) {
									archiveMutation.mutate(
										{ userId: confirmEmail.userId, archived: false },
										done,
									);
								} else {
									confirmMutation.mutate(confirmEmail.userId, done);
								}
							}}
						>
							{confirmEmail?.restore ? "Restore and confirm" : "Confirm"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</PageFull>
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
 * An hourly person's explicit monthly Expected figure (PRD 3.1), in hours.
 *
 * Only hourly students and contractors have one. Everybody else derives Expected from the org's
 * monthly hour fund, so the cell reads as a dash rather than an empty input —
 * an empty box invites you to type a number that would be rejected.
 *
 * Blank means "no Expected at all": the "/" rows of the old PM sheet, where a
 * person shows hours and no pace percentage.
 */
function ExpectedHoursCell({
	type,
	expectedSecondsOverride,
	onCommit,
}: {
	type: MemberTypeValue;
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

	if (!isHourlyMemberType(type)) {
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
