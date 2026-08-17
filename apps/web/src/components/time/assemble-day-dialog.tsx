import {
	CalendarDotIcon,
	CoffeeIcon,
	GitCommitIcon,
	VideoCameraIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
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
import { Switch } from "#/components/ui/switch.tsx";
import { formatDateKeyLong } from "#/lib/format-date.ts";
import { formatHoursShort } from "#/lib/format-hours.ts";
import { dayAssemblySuggestionsQuery } from "#/queries/day-assembly.ts";
import { queryKeys } from "#/queries/keys.ts";
import {
	applyDayAssembly,
	type suggestDayAssembly,
} from "#/server/day-assembly.ts";

type DayAssembly = Awaited<ReturnType<typeof suggestDayAssembly>>;
type DaySuggestion = DayAssembly["suggestions"][number];

function suggestionTitle(s: DaySuggestion): string {
	if (s.kind === "meeting") return s.description || "Meeting";
	if (s.kind === "work") return s.projectName ?? s.taskName;
	if (s.kind === "break") return "Break";
	return "Work — rest of day";
}

function SuggestionIcon({ kind }: { kind: DaySuggestion["kind"] }) {
	const Icon =
		kind === "meeting"
			? VideoCameraIcon
			: kind === "work"
				? GitCommitIcon
				: kind === "break"
					? CoffeeIcon
					: CalendarDotIcon;
	return <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />;
}

export function AssembleDayDialog({
	orgSlug,
	date,
	trigger,
}: {
	orgSlug: string;
	date: string;
	trigger: React.ReactElement;
}) {
	const [open, setOpen] = useState(false);
	const queryClient = useQueryClient();

	// Per-opening, not remembered. "Show me the ones I deleted" is a thing you
	// want on the day you lost something, and a setting that stays on quietly
	// re-offers every deletion you ever made, on every day, forever — which is
	// the behaviour the tombstones exist to prevent.
	const [includeDismissed, setIncludeDismissed] = useState(false);
	useEffect(() => {
		if (!open) setIncludeDismissed(false);
	}, [open]);

	const suggestionsQ = useQuery({
		...dayAssemblySuggestionsQuery(date, includeDismissed),
		enabled: open,
	});
	const assembly = suggestionsQ.data;
	const suggestions = assembly?.suggestions ?? [];

	const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
	// Fresh suggestions arrive pre-selected — assembling should be one click.
	// Except the ones the person deleted before: those are here because they
	// asked to see them, which is not the same as asking for them back.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset only when a new suggestion set arrives
	useEffect(() => {
		setSelectedKeys(
			new Set(suggestions.filter((s) => !s.dismissed).map((s) => s.key)),
		);
	}, [suggestionsQ.dataUpdatedAt]);

	const toggle = (key: string) => {
		setSelectedKeys((current) => {
			const next = new Set(current);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});
	};

	const selected = suggestions.filter((s) => selectedKeys.has(s.key));
	const selectedSeconds = selected.reduce(
		(sum, s) => sum + s.durationSeconds,
		0,
	);

	const applyMutation = useMutation({
		mutationFn: () =>
			applyDayAssembly({
				data: {
					date,
					entries: selected.map((s) => ({
						taskId: s.taskId,
						projectId: s.projectId ?? undefined,
						description: s.description || undefined,
						// A fill suggestion's duration is recomputed server-side from the
						// day's remaining working hours, so it deliberately sends none.
						durationSeconds: s.fillsDay ? undefined : s.durationSeconds,
						fillsDay: s.fillsDay || undefined,
						meetingUrl: s.meetingUrl ?? undefined,
						calendarEventId: s.calendarEventId ?? undefined,
						commits:
							s.commits.length > 0
								? s.commits.map((c) => ({
										projectGithubRepoId: c.projectGithubRepoId,
										sha: c.sha,
									}))
								: undefined,
					})),
				},
			}),
		onSuccess: async ({ created, errors }) => {
			await queryClient.invalidateQueries({
				queryKey: [...queryKeys.timeEntries],
			});
			await queryClient.invalidateQueries({
				queryKey: [...queryKeys.dayAssembly],
			});
			if (errors.length > 0) {
				toast.error(
					`Added ${created} ${created === 1 ? "block" : "blocks"}, ${errors.length} failed: ${errors[0]}`,
				);
			} else {
				toast.success(`Added ${created} ${created === 1 ? "block" : "blocks"}`);
			}
			setOpen(false);
		},
		onError: (error) => {
			toast.error(error.message ?? "Could not assemble the day");
		},
	});

	const missingSources: string[] = [];
	if (assembly?.sources.calendar === "unavailable") {
		missingSources.push("Google Calendar");
	}
	if (assembly?.sources.github === "unavailable") missingSources.push("GitHub");

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger render={trigger} />
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Assemble my day</DialogTitle>
					<p className="text-sm text-muted-foreground">
						{formatDateKeyLong(date)}
						{assembly && (
							<>
								{" · "}
								{formatHoursShort(assembly.loggedSeconds)} logged of{" "}
								{formatHoursShort(assembly.targetSeconds)} target
							</>
						)}
					</p>
				</DialogHeader>

				{/* Left-aligned like every other message in the app — centred text
				    inside a dialog reads as a placeholder screen, not as an answer to
				    the question the title just asked. */}
				{suggestionsQ.isPending ? (
					<p className="py-6 text-base text-muted-foreground">
						Reading your calendar, commits, and working hours…
					</p>
				) : suggestionsQ.isError ? (
					<p className="py-6 text-base text-destructive">
						Could not build suggestions. Try again in a moment.
					</p>
				) : suggestions.length === 0 ? (
					<p className="py-6 text-base text-muted-foreground">
						{(assembly?.dismissedCount ?? 0) > 0
							? "Nothing new to add — but this day has blocks you deleted."
							: "Nothing to add — this day already matches your working hours."}
					</p>
				) : (
					// A list, not a card: hairlines above and below, rows divided by the
					// lighter repeat-rule weight.
					<div className="-mx-5 divide-y divide-line2 border-y">
						{suggestions.map((s) => (
							<label
								key={s.key}
								className="flex cursor-pointer items-start gap-3 px-5 py-2.5 transition-colors duration-(--dur-fast) hover:bg-muted"
							>
								<input
									type="checkbox"
									className="mt-1 accent-primary"
									checked={selectedKeys.has(s.key)}
									onChange={() => toggle(s.key)}
								/>
								<SuggestionIcon kind={s.kind} />
								<span className="min-w-0 flex-1">
									<span className="flex items-center gap-2">
										<span className="min-w-0 truncate text-sm font-medium">
											{suggestionTitle(s)}
										</span>
										{/* Named, not just silently present: a row that arrives
										    unticked among ticked ones needs to say why. */}
										{s.dismissed && (
											<span className="shrink-0 text-xs text-muted-foreground">
												deleted earlier
											</span>
										)}
									</span>
									<span className="block text-xs text-muted-foreground">
										{s.fillsDay
											? `Fills the rest of the day · ~${formatHoursShort(s.durationSeconds)}`
											: `${s.taskName} · ${formatHoursShort(s.durationSeconds)}`}
										{s.commits.length > 0 &&
											` · ${s.commits.length} ${s.commits.length === 1 ? "commit" : "commits"}`}
									</span>
									{s.kind === "work" && s.description && (
										<span className="block truncate text-xs text-muted-foreground">
											{s.description}
										</span>
									)}
								</span>
							</label>
						))}
					</div>
				)}

				{/* Only on a day that actually has something behind it. A switch that
				    is always there and usually does nothing is one people stop reading;
				    one that appears saying "2 you deleted" answers a question they are
				    already asking. Below the list, because it is an answer to "is that
				    everything?" rather than a filter to set before looking. */}
				{suggestionsQ.isSuccess && assembly && assembly.dismissedCount > 0 && (
					<label
						htmlFor="assemble-include-dismissed"
						className="flex cursor-pointer items-start gap-3"
					>
						<Switch
							id="assemble-include-dismissed"
							checked={includeDismissed}
							onCheckedChange={setIncludeDismissed}
							className="mt-0.5"
						/>
						<span className="min-w-0 flex-1 text-sm">
							Also offer things I deleted
							<span className="block text-xs text-muted-foreground">
								{assembly.dismissedCount === 1
									? "1 block deleted on this day — it won't come back on its own"
									: `${assembly.dismissedCount} blocks deleted on this day — they won't come back on their own`}
							</span>
						</span>
					</label>
				)}

				{missingSources.length > 0 && suggestionsQ.isSuccess && (
					<p className="text-sm text-muted-foreground">
						{missingSources.join(" and ")} not connected —{" "}
						<Link
							to="/$orgSlug/settings/integrations"
							params={{ orgSlug }}
							className="underlined text-primary"
							onClick={() => setOpen(false)}
						>
							connect in settings
						</Link>{" "}
						for richer suggestions.
					</p>
				)}

				<DialogFooter className="items-center gap-3">
					{selected.length > 0 && (
						<span className="text-xs text-muted-foreground">
							{formatHoursShort(selectedSeconds)} selected
						</span>
					)}
					<Button
						onClick={() => applyMutation.mutate()}
						disabled={selected.length === 0 || applyMutation.isPending}
					>
						{applyMutation.isPending
							? "Adding…"
							: `Add ${selected.length} ${selected.length === 1 ? "block" : "blocks"}`}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
