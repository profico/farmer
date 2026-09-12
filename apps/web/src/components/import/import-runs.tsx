import {
	type QueryClient,
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { StatusPill } from "#/components/status-pill.tsx";
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
import { Button } from "#/components/ui/button.tsx";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { formatDateKeyLong } from "#/lib/format-date.ts";
import { harvestRunsQuery } from "#/queries/harvest-import.ts";
import { undoHarvestImport } from "#/server/harvest-import.ts";

/**
 * Stales every query of this org. An import or an undo writes clients,
 * projects, tasks, people, entries and the automation lock at once, so
 * naming the families one by one would be a list that goes out of date the
 * first time the import writes one more.
 */
export const invalidateOrg = (queryClient: QueryClient, orgSlug: string) =>
	queryClient.invalidateQueries({
		predicate: (query) => query.queryKey[1] === orgSlug,
	});

const STATUS = {
	started: { tone: "warning", label: "Not finished" },
	finished: { tone: "positive", label: "Finished" },
	undone: { tone: "neutral", label: "Undone" },
} as const;

const dateOf = (d: Date | string) =>
	formatDateKeyLong(new Date(d).toISOString().slice(0, 10));

export function ImportRuns({ busy }: { busy: boolean }) {
	const orgSlug = useOrgSlug();
	const queryClient = useQueryClient();
	const { data: runs } = useSuspenseQuery(harvestRunsQuery(orgSlug));
	const [confirmId, setConfirmId] = useState<string | null>(null);

	// Only the latest run that is not undone can be undone: an earlier run's
	// rows may be what a later run matched and built on.
	const latest = runs.find((r) => r.status !== "undone");

	const undo = useMutation({
		mutationFn: (runId: string) => undoHarvestImport({ data: { runId } }),
		onSuccess: async (result) => {
			setConfirmId(null);
			toast.success(
				`Import undone: ${result.entriesDeleted.toLocaleString("en-US")} entries and ${result.peopleRemoved} people removed`,
			);
			await invalidateOrg(queryClient, orgSlug);
		},
		onError: (error) =>
			toast.error(error.message ?? "Could not undo the import"),
	});

	if (runs.length === 0) {
		return <p className="text-sm text-muted-foreground">No import yet.</p>;
	}

	return (
		<>
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Started</TableHead>
						<TableHead>By</TableHead>
						<TableHead>Cutoff</TableHead>
						<TableHead>Status</TableHead>
						<TableHead className="text-right">Entries</TableHead>
						<TableHead />
					</TableRow>
				</TableHeader>
				<TableBody>
					{runs.map((run) => (
						<TableRow key={run.id}>
							<TableCell>{dateOf(run.createdAt)}</TableCell>
							<TableCell className="text-muted-foreground">
								{run.createdByName ?? "—"}
							</TableCell>
							<TableCell className="mono">{run.cutoffDate}</TableCell>
							<TableCell>
								<StatusPill tone={STATUS[run.status].tone}>
									{STATUS[run.status].label}
								</StatusPill>
							</TableCell>
							<TableCell className="mono text-right">
								{run.entriesCreated.toLocaleString("en-US")}
							</TableCell>
							<TableCell className="text-right">
								{run.id === latest?.id && (
									<Button
										size="sm"
										variant="ghost"
										disabled={busy || undo.isPending}
										onClick={() => setConfirmId(run.id)}
									>
										Undo
									</Button>
								)}
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>

			<AlertDialog
				open={confirmId != null}
				onOpenChange={(open) => {
					if (!open) setConfirmId(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Undo this import?</AlertDialogTitle>
						<AlertDialogDescription>
							Undo deletes the entries, projects, clients, tasks and people that
							this import added. It does not bring back the days that this
							import replaced, and it does not move the automation lock back. If
							a person that the import added has signed in since, undo stops:
							archive that person instead.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							disabled={undo.isPending}
							onClick={() => {
								if (confirmId) undo.mutate(confirmId);
							}}
						>
							{undo.isPending ? "Undoing…" : "Undo import"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
