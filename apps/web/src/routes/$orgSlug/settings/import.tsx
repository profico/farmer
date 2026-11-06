import type {
	HarvestChoices,
	HarvestSnapshot,
} from "@farmer/core/lib/harvest/index";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { DropZone } from "#/components/import/drop-zone.tsx";
import { HarvestReview } from "#/components/import/harvest-review.tsx";
import type { HarvestPlanView } from "#/components/import/harvest-worker-protocol.ts";
import { ImportProgress } from "#/components/import/import-progress.tsx";
import { ImportRuns, invalidateOrg } from "#/components/import/import-runs.tsx";
import { useHarvestWorker } from "#/components/import/use-harvest-worker.ts";
import { useImportRunner } from "#/components/import/use-import-runner.ts";
import { SettingsEyebrow } from "#/components/settings-nav.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Page, PageHeader, PageSection } from "#/components/ui/page-header.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { harvestRunsQuery } from "#/queries/harvest-import.ts";
import { requireOrgAdmin } from "#/server/auth.ts";
import {
	checkHarvestEmails,
	getHarvestSnapshot,
} from "#/server/harvest-import.ts";

export const Route = createFileRoute("/$orgSlug/settings/import")({
	beforeLoad: async () => {
		await requireOrgAdmin();
	},
	loader: async ({ context, params }) => {
		await context.queryClient.ensureQueryData(harvestRunsQuery(params.orgSlug));
	},
	component: ImportPage,
});

/** The server's own check on an address, so one bad cell in the people list
 *  cannot fail the snapshot for all of them. */
const emailSchema = z.email().max(320);

/** What the snapshot call accepts in one request. */
const SNAPSHOT_EMAILS = 2000;
const CHECK_EMAILS = 500;

type Planned = {
	planId: number;
	plan: HarvestPlanView;
	chunkCount: number;
	rowsToSend: number;
	/** The inputs this plan was built from: a plan for older ones is stale. */
	choices: HarvestChoices;
	snapshot: HarvestSnapshot;
};

function ImportPage() {
	const orgSlug = useOrgSlug();
	const queryClient = useQueryClient();
	const worker = useHarvestWorker();

	const [files, setFiles] = useState<File[]>([]);
	const [busy, setBusy] = useState<string | null>(null);
	const [snapshot, setSnapshot] = useState<HarvestSnapshot | null>(null);
	const [choices, setChoices] = useState<HarvestChoices | null>(null);
	const [planned, setPlanned] = useState<Planned | null>(null);
	const [importing, setImporting] = useState(false);
	const planSeq = useRef(0);
	const defaultCutoff = useRef<string | null>(null);

	const onFinished = useCallback(() => {
		void invalidateOrg(queryClient, orgSlug);
	}, [queryClient, orgSlug]);
	const runner = useImportRunner(worker, onFinished);

	// Re-plan on every change of choices. Only the newest answer is kept, so a
	// slow plan for an older choice cannot overwrite a newer one. Paused while
	// the import runs: a new plan replaces the chunks the runner reads from.
	useEffect(() => {
		if (!snapshot || !choices || importing) return;
		planSeq.current += 1;
		const seq = planSeq.current;
		worker.plan(snapshot, choices).then(
			(res) => {
				if (seq === planSeq.current) {
					setPlanned({ ...res, choices, snapshot });
				}
			},
			(err: Error) => toast.error(err.message),
		);
	}, [worker, snapshot, choices, importing]);

	const addFiles = async (added: File[]) => {
		const csv = added.filter((f) => f.name.toLowerCase().endsWith(".csv"));
		if (csv.length === 0) {
			toast.error("Drop the CSV files that Harvest exports.");
			return;
		}
		const byName = new Map(files.map((f) => [f.name, f]));
		for (const f of csv) byName.set(f.name, f);
		const next = [...byName.values()];
		setFiles(next);
		try {
			setBusy("Reading the files");
			const texts = await Promise.all(
				next.map(async (f) => ({ name: f.name, text: await f.text() })),
			);
			setBusy("Reading the time report. A large one takes a few seconds.");
			const parsed = await worker.parse(texts);
			setBusy("Reading what this workspace already holds");
			const cutoff = choices?.cutoffDate ?? parsed.choices.cutoffDate;
			const range = parsed.range ?? { from: cutoff, to: cutoff };
			const emails = parsed.candidateEmails
				.filter((e) => emailSchema.safeParse(e).success)
				.slice(0, SNAPSHOT_EMAILS);
			const snap = await getHarvestSnapshot({ data: { ...range, emails } });
			setSnapshot(snap);
			// A file added later keeps what the admin already chose: every
			// choice is keyed by Harvest name, and the names do not change.
			// The default cutoff follows the files, so it moves with a later file
			// until the admin sets it.
			const fallbackCutoff = defaultCutoff.current;
			defaultCutoff.current = parsed.choices.cutoffDate;
			setChoices((current) =>
				current === null
					? parsed.choices
					: current.cutoffDate === fallbackCutoff
						? { ...current, cutoffDate: parsed.choices.cutoffDate }
						: current,
			);
		} catch (err) {
			toast.error(
				err instanceof Error ? err.message : "Could not read the files",
			);
		} finally {
			setBusy(null);
		}
	};

	const fresh =
		planned !== null &&
		planned.choices === choices &&
		planned.snapshot === snapshot;

	const startImport = async () => {
		if (!planned || !choices) return;
		let current = planned;
		// Addresses the admin typed were not in the snapshot call, so the
		// server has not said yet whether another user holds them.
		if (current.plan.emailsToCheck.length > 0) {
			try {
				setBusy("Checking the addresses you typed");
				const emails = current.plan.emailsToCheck;
				const taken: string[] = [];
				for (let i = 0; i < emails.length; i += CHECK_EMAILS) {
					taken.push(
						...(await checkHarvestEmails({
							data: { emails: emails.slice(i, i + CHECK_EMAILS) },
						})),
					);
				}
				const snap = {
					...current.snapshot,
					takenEmails: [
						...new Set([...current.snapshot.takenEmails, ...taken]),
					],
				};
				const res = await worker.plan(snap, choices);
				current = { ...res, choices, snapshot: snap };
				setSnapshot(snap);
				setPlanned(current);
			} catch (err) {
				toast.error(
					err instanceof Error ? err.message : "Could not check the addresses",
				);
				return;
			} finally {
				setBusy(null);
			}
			if (!current.plan.ready) {
				toast.error(
					"An address belongs to a user outside this workspace. Change it.",
				);
				return;
			}
		}
		setImporting(true);
		runner.run(current.planId, current.plan, current.chunkCount);
	};

	const reset = () => {
		runner.reset();
		setImporting(false);
		setFiles([]);
		setSnapshot(null);
		setChoices(null);
		setPlanned(null);
	};

	return (
		<Page>
			<PageHeader
				eyebrow={<SettingsEyebrow />}
				title="Import from Harvest"
				lede="Bring clients, projects, tasks, people and time in from the CSV files that Harvest exports. You can import the same files again: the import adds only what changed."
			/>

			{importing ? (
				<ImportProgress
					state={runner.state}
					onRetry={runner.retry}
					onReset={reset}
				/>
			) : (
				<>
					<PageSection
						title="Files"
						action={
							files.length > 0 && (
								<Button
									variant="ghost"
									size="sm"
									onClick={reset}
									disabled={!!busy}
								>
									Start again
								</Button>
							)
						}
					>
						<DropZone
							onFiles={(added) => void addFiles(added)}
							disabled={!!busy}
							compact={snapshot !== null}
						/>
						{busy && (
							<p className="mt-3 text-sm text-muted-foreground">{busy}</p>
						)}
					</PageSection>

					{planned && snapshot && choices && (
						<>
							<HarvestReview
								plan={planned.plan}
								snapshot={snapshot}
								choices={choices}
								onChoices={setChoices}
							/>
							<PageSection>
								<div className="flex flex-wrap items-center justify-end gap-4">
									<span className="text-sm text-muted-foreground">
										{fresh
											? planned.plan.ready
												? `${planned.rowsToSend.toLocaleString("en-US")} rows in ${planned.chunkCount} parts`
												: "Fix the items at the top first."
											: "Updating the plan…"}
									</span>
									<Button
										disabled={!fresh || !planned.plan.ready || !!busy}
										onClick={() => void startImport()}
									>
										Import
									</Button>
								</div>
							</PageSection>
						</>
					)}
				</>
			)}

			<PageSection
				title="Earlier imports"
				description="You can undo the latest import. Undo removes what that import added."
			>
				<ImportRuns busy={runner.state.status === "running"} />
			</PageSection>
		</Page>
	);
}
