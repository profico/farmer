import { inviteMemberInput } from "@farmer/core/schema";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { Button } from "#/components/ui/button.tsx";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "#/components/ui/dialog.tsx";
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "#/components/ui/form.tsx";
import { Input } from "#/components/ui/input.tsx";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { pendingInvitationsQuery } from "#/queries/members.ts";
import { inviteMember } from "#/server/members.ts";

const ROLE_OPTIONS = [
	{ value: "member", label: "Member" },
	{ value: "admin", label: "Admin" },
];

export function InviteMemberDialog() {
	const orgSlug = useOrgSlug();
	const [open, setOpen] = useState(false);
	const queryClient = useQueryClient();
	const form = useForm<z.infer<typeof inviteMemberInput>>({
		resolver: zodResolver(inviteMemberInput),
		defaultValues: { email: "", role: "member" },
	});

	const mutation = useMutation({
		mutationFn: (data: z.infer<typeof inviteMemberInput>) =>
			inviteMember({ data }),
		// Optimistic: the dialog closes on submit, not on the answer. A refusal
		// (already a member, already invited) opens it again with what was typed,
		// so nothing has to be entered twice.
		onMutate: () => {
			setOpen(false);
			form.reset({ email: "", role: "member" });
		},
		// Only the invitations list moves. `membersQuery`'s key is the root of
		// every member query — people, directory, type history — and an
		// invitation is not a membership until somebody accepts it.
		onSuccess: () => {
			toast.success("Invitation sent");
			return queryClient.invalidateQueries({
				queryKey: pendingInvitationsQuery(orgSlug).queryKey,
			});
		},
		onError: (error, data) => {
			toast.error(error.message ?? "Could not send invitation");
			form.reset(data);
			setOpen(true);
		},
	});

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger render={<Button>+ Invite member</Button>} />
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Invite member</DialogTitle>
				</DialogHeader>
				<Form {...form}>
					<form
						onSubmit={form.handleSubmit((data) => mutation.mutate(data))}
						className="grid grid-cols-[minmax(0,1fr)] gap-4"
					>
						<FormField
							control={form.control}
							name="email"
							render={({ field }) => (
								<FormItem>
									<FormLabel required>Email</FormLabel>
									<FormControl>
										<Input type="email" autoFocus {...field} />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="role"
							render={({ field }) => (
								<FormItem>
									<FormLabel required>Role</FormLabel>
									<Select
										value={field.value}
										onValueChange={field.onChange}
										items={ROLE_OPTIONS}
									>
										<FormControl>
											<SelectTrigger className="w-full">
												<SelectValue />
											</SelectTrigger>
										</FormControl>
										<SelectContent>
											{ROLE_OPTIONS.map((opt) => (
												<SelectItem key={opt.value} value={opt.value}>
													{opt.label}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
									<FormMessage />
								</FormItem>
							)}
						/>
						<DialogFooter>
							<Button type="submit">Send invite</Button>
						</DialogFooter>
					</form>
				</Form>
			</DialogContent>
		</Dialog>
	);
}
