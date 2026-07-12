import {
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { InviteMemberDialog } from "#/components/invite-member-dialog.tsx";
import { Button } from "#/components/ui/button.tsx";
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
import { membersQuery, pendingInvitationsQuery } from "#/queries/members.ts";
import { requireOrgAdmin } from "#/server/auth.ts";
import {
	cancelInvitation,
	removeMember,
	updateMemberRole,
} from "#/server/members.ts";

const ROLE_ITEMS = [
	{ value: "member", label: "Member" },
	{ value: "admin", label: "Admin" },
];

export const Route = createFileRoute("/$orgSlug/settings/members")({
	beforeLoad: async () => {
		await requireOrgAdmin();
	},
	loader: async ({ context }) => {
		await Promise.all([
			context.queryClient.ensureQueryData(membersQuery()),
			context.queryClient.ensureQueryData(pendingInvitationsQuery()),
		]);
	},
	component: MembersSettingsPage,
});

function MembersSettingsPage() {
	const { session } = Route.useRouteContext();
	const { data: membersData } = useSuspenseQuery(membersQuery());
	const { data: invitations } = useSuspenseQuery(pendingInvitationsQuery());
	const queryClient = useQueryClient();

	const owners = membersData.members.filter((m) => m.role === "owner");

	const invalidate = () =>
		Promise.all([
			queryClient.invalidateQueries({ queryKey: membersQuery().queryKey }),
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

	const cancelMutation = useMutation({
		mutationFn: (invitationId: string) =>
			cancelInvitation({ data: invitationId }),
		onSuccess: invalidate,
		onError: (error) =>
			toast.error(error.message ?? "Could not cancel invitation"),
	});

	return (
		<div className="page-shell">
			<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<h1 className="font-display text-xl">Members</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						Manage who has access to this organization.
					</p>
				</div>
				<InviteMemberDialog />
			</div>

			<Table
				className="border-t [&_td:first-child]:pl-8 [&_td:last-child]:pr-8 [&_th:first-child]:pl-8 [&_th:last-child]:pr-8"
				containerClassName="-mx-4 mt-6 border-b sm:-mx-8"
			>
				<TableHeader>
					<TableRow>
						<TableHead>Name</TableHead>
						<TableHead>Email</TableHead>
						<TableHead>Role</TableHead>
						<TableHead />
					</TableRow>
				</TableHeader>
				<TableBody>
					{membersData.members.map((m) => {
						const isSelf = m.userId === session.user.id;
						const isOnlyOwner = m.role === "owner" && owners.length <= 1;
						return (
							<TableRow key={m.id}>
								<TableCell className="font-medium">{m.user.name}</TableCell>
								<TableCell>{m.user.email}</TableCell>
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
									{!isSelf && !isOnlyOwner && (
										<Button
											variant="destructive"
											size="sm"
											disabled={removeMutation.isPending}
											onClick={() => removeMutation.mutate(m.id)}
										>
											Remove
										</Button>
									)}
								</TableCell>
							</TableRow>
						);
					})}
				</TableBody>
			</Table>

			{invitations.length > 0 && (
				<div className="mt-8">
					<h2 className="text-sm font-semibold">Pending invitations</h2>
					<Table
						className="border-t [&_td:first-child]:pl-8 [&_td:last-child]:pr-8 [&_th:first-child]:pl-8 [&_th:last-child]:pr-8"
						containerClassName="-mx-4 mt-3 border-b sm:-mx-8"
					>
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
		</div>
	);
}
