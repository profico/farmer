import type { UseMutationResult } from "@tanstack/react-query";
import {
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { CreateRecurringBlockRuleDialog } from "#/components/recurring-block-rule-dialog.tsx";
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
	AlertDialogTrigger,
} from "#/components/ui/alert-dialog.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Page, PageHeader } from "#/components/ui/page-header.tsx";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table.tsx";
import { resolveCategoryColor } from "#/lib/category-colors.ts";
import { formatHoursShort } from "#/lib/format-hours.ts";
import { cn } from "#/lib/utils.ts";
import { projectsQuery } from "#/queries/projects.ts";
import { recurringBlockRulesQuery } from "#/queries/recurring-block-rules.ts";
import {
	deleteRecurringBlockRule,
	updateRecurringBlockRule,
} from "#/server/recurring-block-rules.ts";

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"]; // index 0=Sun..6=Sat

export const Route = createFileRoute("/$orgSlug/settings/recurring-blocks")({
	loader: async ({ context }) => {
		await Promise.all([
			context.queryClient.ensureQueryData(recurringBlockRulesQuery()),
			context.queryClient.ensureQueryData(projectsQuery()),
		]);
	},
	component: RecurringBlocksPage,
});

function DayPills({ daysOfWeek }: { daysOfWeek: number[] }) {
	return (
		<div className="flex gap-1">
			{DAY_LABELS.map((label, day) => (
				<span
					// biome-ignore lint/suspicious/noArrayIndexKey: day is the stable weekday number (0-6), not an incidental index
					key={day}
					className={cn(
						"mono flex size-5 items-center justify-center rounded-full text-[10px]",
						daysOfWeek.includes(day)
							? "bg-primary text-primary-foreground"
							: "bg-muted text-muted-foreground",
					)}
				>
					{label}
				</span>
			))}
		</div>
	);
}

function RecurringBlocksPage() {
	const { data: rules } = useSuspenseQuery(recurringBlockRulesQuery());
	const queryClient = useQueryClient();

	const invalidate = () =>
		queryClient.invalidateQueries({
			queryKey: recurringBlockRulesQuery().queryKey,
		});

	const toggleMutation = useMutation({
		mutationFn: (vars: { ruleId: string; active: boolean }) =>
			updateRecurringBlockRule({ data: vars }),
		onSuccess: invalidate,
		onError: (error) => {
			toast.error(error.message ?? "Could not update recurring block");
		},
	});

	const deleteMutation = useMutation({
		mutationFn: (ruleId: string) => deleteRecurringBlockRule({ data: ruleId }),
		onSuccess: invalidate,
		onError: (error) => {
			toast.error(error.message ?? "Could not delete recurring block");
		},
	});

	return (
		<Page className="screen">
			<PageHeader
				eyebrow="Your schedule"
				title="Recurring blocks"
				lede="Blocks — a daily break, a standing meeting — that appear on your calendar without you logging them."
				action={<CreateRecurringBlockRuleDialog />}
				className="mb-0"
			/>
			{rules.length === 0 ? (
				<div className="mt-8 border-t pt-6">
					<p className="h2">No recurring blocks yet</p>
					<p className="lede mt-2">
						Add one and it will fill itself in every week.
					</p>
				</div>
			) : (
				<Table containerClassName="mt-6">
					<TableHeader>
						<TableRow>
							<TableHead>Task</TableHead>
							<TableHead>Project</TableHead>
							<TableHead>Days</TableHead>
							<TableHead>Duration</TableHead>
							<TableHead>Status</TableHead>
							<TableHead />
						</TableRow>
					</TableHeader>
					<TableBody>
						{rules.map((rule) => {
							const category = resolveCategoryColor(rule.task.color);
							return (
								<TableRow
									key={rule.id}
									className={cn(!rule.active && "opacity-60")}
								>
									<TableCell className="font-medium">
										<span className="flex items-center gap-2">
											<span
												className="size-2 shrink-0 rounded-full"
												style={{ backgroundColor: category.dot }}
											/>
											{rule.task.name}
										</span>
									</TableCell>
									<TableCell>{rule.project?.name ?? "—"}</TableCell>
									<TableCell>
										<DayPills daysOfWeek={rule.daysOfWeek} />
									</TableCell>
									<TableCell>
										<span className="font-display text-[15px]">
											{formatHoursShort(rule.durationSeconds)}
										</span>
									</TableCell>
									<TableCell>
										<StatusPill tone={rule.active ? "positive" : "neutral"}>
											{rule.active ? "Active" : "Paused"}
										</StatusPill>
									</TableCell>
									<TableCell className="flex gap-1">
										<Button
											variant="ghost"
											size="sm"
											onClick={() =>
												toggleMutation.mutate({
													ruleId: rule.id,
													active: !rule.active,
												})
											}
										>
											{rule.active ? "Pause" : "Resume"}
										</Button>
										<DeleteRuleButton
											ruleId={rule.id}
											deleteMutation={deleteMutation}
										/>
									</TableCell>
								</TableRow>
							);
						})}
					</TableBody>
				</Table>
			)}
		</Page>
	);
}

function DeleteRuleButton({
	ruleId,
	deleteMutation,
}: {
	ruleId: string;
	deleteMutation: UseMutationResult<unknown, Error, string>;
}) {
	const [open, setOpen] = useState(false);

	return (
		<AlertDialog open={open} onOpenChange={setOpen}>
			<AlertDialogTrigger
				render={
					<Button variant="ghost" size="sm">
						Delete
					</Button>
				}
			/>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Delete this recurring block?</AlertDialogTitle>
					<AlertDialogDescription>
						This action cannot be undone.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<AlertDialogAction
						variant="destructive"
						onClick={() => {
							deleteMutation.mutate(ruleId, {
								onSuccess: () => setOpen(false),
							});
						}}
						disabled={deleteMutation.isPending}
					>
						Delete
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
