import { PencilSimpleIcon } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "#/components/ui/button.tsx";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "#/components/ui/dialog.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Label } from "#/components/ui/label.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { weeklyTargetQuery } from "#/queries/working-hours.ts";
import { setWeeklyTarget } from "#/server/working-hours.ts";

export function EditWeeklyTargetDialog({
	currentHours,
}: {
	currentHours: number;
}) {
	const orgSlug = useOrgSlug();
	const [open, setOpen] = useState(false);
	const [hours, setHours] = useState(String(currentHours));
	const queryClient = useQueryClient();

	/* oxlint-disable react-hooks/exhaustive-deps -- only reset when the dialog opens */
	useEffect(() => {
		if (open) setHours(String(currentHours));
	}, [open]);
	/* oxlint-enable react-hooks/exhaustive-deps */

	const trimmed = hours.trim();
	const canSubmit = trimmed.length > 0 && !Number.isNaN(Number(trimmed));

	const mutation = useMutation({
		mutationFn: (weeklyTarget: string) =>
			setWeeklyTarget({ data: { weeklyTarget } }),
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: weeklyTargetQuery(orgSlug).queryKey,
			});
			setOpen(false);
		},
		onError: (error) => {
			toast.error(error.message ?? "Could not update weekly target");
		},
	});

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger
				render={
					<Button variant="ghost" size="icon-xs">
						<PencilSimpleIcon className="size-3" />
						<span className="sr-only">Edit weekly target</span>
					</Button>
				}
			/>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Weekly target</DialogTitle>
				</DialogHeader>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						if (canSubmit) mutation.mutate(hours);
					}}
					className="grid gap-4"
				>
					<div className="grid gap-2">
						<Label htmlFor="weekly-target-hours">Hours per week</Label>
						<Input
							id="weekly-target-hours"
							type="number"
							min="1"
							max="168"
							step="0.5"
							value={hours}
							onChange={(e) => setHours(e.target.value)}
						/>
					</div>
					<DialogFooter>
						<Button type="submit" disabled={!canSubmit || mutation.isPending}>
							Save
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
