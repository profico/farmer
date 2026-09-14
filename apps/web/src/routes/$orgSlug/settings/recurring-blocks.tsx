import { matchesSearch } from "@farmer/core/lib/search";
import { DEFAULT_BREAK_BLOCK } from "@farmer/core/schema";
import type { UseMutationResult } from "@tanstack/react-query";
import {
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import {
	CreateRecurringBlockRuleDialog,
	EditRecurringBlockRuleDialog,
} from "#/components/recurring-block-rule-dialog.tsx";
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
	AlertDialogTrigger,
} from "#/components/ui/alert-dialog.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Page, PageHeader } from "#/components/ui/page-header.tsx";
import { NoMatchesRow, SearchInput } from "#/components/ui/search-input.tsx";
import { Switch } from "#/components/ui/switch.tsx";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { resolveCategoryColor } from "#/lib/category-colors.ts";
import { formatHoursShort } from "#/lib/format-hours.ts";
import { cn } from "#/lib/utils.ts";
import { queryKeys } from "#/queries/keys.ts";
import { projectsQuery } from "#/queries/projects.ts";
import { recurringBlockRulesQuery } from "#/queries/recurring-block-rules.ts";
import {
	deleteRecurringBlockRule,
	enableDefaultBreakBlock,
	updateRecurringBlockRule,
} from "#/server/recurring-block-rules.ts";

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"]; // index 0=Sun..6=Sat

export const Route = createFileRoute("/$orgSlug/settings/recurring-blocks")({
	loader: async ({ context, params }) => {
		const orgSlug = params.orgSlug;
		await Promise.all([
			context.queryClient.ensureQueryData(recurringBlockRulesQuery(orgSlug)),
			context.queryClient.ensureQueryData(projectsQuery(orgSlug)),
		]);
	},
	component: RecurringBlocksPage,
});

function DayPills({ daysOfWeek }: { daysOfWeek: number[] }) {
	return (
		<div className="flex gap-1">
			{DAY_LABELS.map((label, day) => (
				<span
					// oxlint-disable-next-line react/no-array-index-key -- day is the stable weekday number (0-6), not an incidental index
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
	const orgSlug = useOrgSlug();
	const { data: rules } = useSuspenseQuery(recurringBlockRulesQuery(orgSlug));
	const queryClient = useQueryClient();

	// Rules materialize into real entries lazily, on the next read of a date
	// range — so switching one on or off changes days the time page may already
	// have cached.
	const invalidate = () =>
		Promise.all([
			queryClient.invalidateQueries({
				queryKey: recurringBlockRulesQuery(orgSlug).queryKey,
			}),
			queryClient.invalidateQueries({
				queryKey: [...queryKeys(orgSlug).timeEntries],
			}),
		]);

	// The proposed break is offered only while the person has no break rule of
	// their own — including a paused one, which is a decision they already made.
	const hasBreakRule = rules.some((rule) => rule.task.systemKey === "break");

	const [query, setQuery] = useState("");
	const shownRules = rules.filter((rule) =>
		matchesSearch(query, [rule.task.name, rule.project?.name]),
	);
	const showSuggestedBreak = !hasBreakRule && matchesSearch(query, ["Break"]);

	const enableBreakMutation = useMutation({
		mutationFn: () => enableDefaultBreakBlock(),
		onSuccess: invalidate,
		onError: (error) => {
			toast.error(error.message ?? "Could not turn on the break");
		},
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
		<Page>
			<PageHeader
				eyebrow={<SettingsEyebrow />}
				title="Recurring blocks"
				lede="Blocks — a daily break, a standing meeting — that appear on your calendar without you logging them."
				action={
					<div className="flex items-center gap-2">
						<SearchInput
							value={query}
							onValueChange={setQuery}
							placeholder="Search blocks…"
							className="flex-1 sm:w-56 sm:flex-none"
						/>
						<CreateRecurringBlockRuleDialog />
					</div>
				}
			/>
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Task</TableHead>
						<TableHead>Project</TableHead>
						<TableHead>Days</TableHead>
						<TableHead>Duration</TableHead>
						<TableHead>On</TableHead>
						<TableHead />
					</TableRow>
				</TableHeader>
				<TableBody>
					{/* The one block that is true of everybody, filled in and switched
					    off. Nothing is written until the switch is flipped — after that
					    it is an ordinary rule, editable and deletable like any other. */}
					{query.trim() !== "" &&
						shownRules.length === 0 &&
						!showSuggestedBreak && (
							<NoMatchesRow colSpan={6}>
								No blocks match your search.
							</NoMatchesRow>
						)}
					{showSuggestedBreak && (
						<TableRow className="opacity-70">
							<TableCell className="font-medium">
								<span className="flex items-center gap-2">
									Break
									<Badge variant="secondary">Suggested</Badge>
								</span>
							</TableCell>
							<TableCell>—</TableCell>
							<TableCell>
								<DayPills daysOfWeek={[...DEFAULT_BREAK_BLOCK.daysOfWeek]} />
							</TableCell>
							<TableCell>
								<span className="font-display text-[15px]">
									{formatHoursShort(DEFAULT_BREAK_BLOCK.durationSeconds)}
								</span>
							</TableCell>
							<TableCell>
								<Switch
									checked={false}
									aria-label="Turn on the daily break"
									disabled={enableBreakMutation.isPending}
									onCheckedChange={() => enableBreakMutation.mutate()}
								/>
							</TableCell>
							<TableCell />
						</TableRow>
					)}
					{shownRules.map((rule) => {
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
									<Switch
										checked={rule.active}
										aria-label={`Turn ${rule.active ? "off" : "on"} the ${rule.task.name} block`}
										disabled={toggleMutation.isPending}
										onCheckedChange={(active) =>
											toggleMutation.mutate({ ruleId: rule.id, active })
										}
									/>
								</TableCell>
								<TableCell className="flex gap-1">
									<EditRecurringBlockRuleDialog rule={rule} />
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
