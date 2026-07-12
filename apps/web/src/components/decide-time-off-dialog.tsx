import { formatDayKeyRange } from "@farmer/core/lib/time";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "#/components/ui/button.tsx";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog.tsx";
import { Label } from "#/components/ui/label.tsx";
import { Textarea } from "#/components/ui/textarea.tsx";
import { pendingTimeOffCountQuery } from "#/queries/time-off.ts";
import { decideTimeOffRequest } from "#/server/time-off.ts";

export type DecideRequest = {
	id: string;
	requesterName: string;
	startDate: string;
	endDate: string;
	type: string;
	label: string | null;
};

export function DecideTimeOffDialog({
	request,
	onOpenChange,
}: {
	request: DecideRequest | null;
	onOpenChange: (open: boolean) => void;
}) {
	const queryClient = useQueryClient();
	const [note, setNote] = useState("");

	const mutation = useMutation({
		mutationFn: (decision: "approved" | "denied") => {
			if (!request) throw new Error("No request");
			return decideTimeOffRequest({
				data: { requestId: request.id, decision, note: note || undefined },
			});
		},
		onSuccess: async () => {
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ["time-off", "all"] }),
				queryClient.invalidateQueries({
					queryKey: pendingTimeOffCountQuery().queryKey,
				}),
				queryClient.invalidateQueries({ queryKey: ["time-off", "balance"] }),
			]);
			onOpenChange(false);
			setNote("");
		},
		onError: (error) => {
			toast.error(error.message ?? "Could not update time off request");
		},
	});

	return (
		<Dialog
			open={Boolean(request)}
			onOpenChange={(open) => {
				onOpenChange(open);
				if (!open) setNote("");
			}}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Review time off</DialogTitle>
				</DialogHeader>
				{request && (
					<div className="grid gap-4">
						<div className="rounded-lg bg-muted/50 px-3 py-2 text-sm">
							<p className="font-medium">{request.requesterName}</p>
							<p className="text-muted-foreground">
								{formatDayKeyRange(request.startDate, request.endDate)} ·{" "}
								<span className="capitalize">{request.type}</span>
							</p>
							{request.label && (
								<p className="mt-0.5 text-muted-foreground">{request.label}</p>
							)}
						</div>
						<div className="grid gap-1.5">
							<Label>Note (optional)</Label>
							<Textarea
								placeholder="Add a note for the requester…"
								value={note}
								onChange={(e) => setNote(e.target.value)}
							/>
						</div>
					</div>
				)}
				<DialogFooter>
					<Button
						variant="destructive"
						disabled={mutation.isPending}
						onClick={() => mutation.mutate("denied")}
					>
						Deny
					</Button>
					<Button
						disabled={mutation.isPending}
						onClick={() => mutation.mutate("approved")}
					>
						Approve
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
