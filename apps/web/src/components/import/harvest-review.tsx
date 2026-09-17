import type {
	HarvestChoices,
	HarvestClientChoice,
	HarvestMatchSource,
	HarvestNegativeDecision,
	HarvestOverlapDecision,
	HarvestPersonChoice,
	HarvestSnapshot,
} from "@farmer/core/lib/harvest/index";
import type { ProjectTypeValue } from "@farmer/core/schema";
import { MEMBER_TYPE_LABELS, memberTypeEnum } from "@farmer/core/schema";
import { useState } from "react";

import { StatusPill } from "#/components/status-pill.tsx";
import { DatePicker } from "#/components/ui/date-picker.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Metric } from "#/components/ui/metric.tsx";
import {
	PageSection,
	SettingList,
	SettingRow,
} from "#/components/ui/page-header.tsx";
import {
	SegmentedControl,
	SegmentedControlItem,
} from "#/components/ui/segmented-control.tsx";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select.tsx";
import { Switch } from "#/components/ui/switch.tsx";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table.tsx";
import { cn } from "#/lib/utils.ts";

import type { HarvestPlanView } from "./harvest-worker-protocol.ts";

const ROLE_ITEMS = [
	{ value: "member", label: "Member" },
	{ value: "admin", label: "Admin" },
] as const;

const TYPE_ITEMS = memberTypeEnum.options.map((value) => ({
	value,
	label: MEMBER_TYPE_LABELS[value],
}));

const PROJECT_TYPE_ITEMS = [
	{ value: "product_team", label: "Product team" },
	{ value: "fixed_scope", label: "Fixed scope" },
	{ value: "hourly", label: "Hourly" },
	{ value: "maintenance", label: "Maintenance" },
	{ value: "internal", label: "Internal" },
] as const satisfies readonly { value: ProjectTypeValue; label: string }[];

const OVERLAP_ITEMS = [
	{ value: "keep_app", label: "Keep this app's entries" },
	{ value: "keep_both", label: "Keep both" },
] as const satisfies readonly {
	value: HarvestOverlapDecision;
	label: string;
}[];

/** A question nobody answered yet. The plan stays blocked while one shows. */
const UNDECIDED = "undecided";

const NEGATIVE_ITEMS = [
	{ value: UNDECIDED, label: "Choose an answer" },
	{ value: "subtract", label: "Subtract from the matching row" },
	{ value: "leave_out", label: "Leave them out" },
] as const satisfies readonly {
	value: HarvestNegativeDecision | typeof UNDECIDED;
	label: string;
}[];

const MATCHED_BY = {
	earlier_import: "Imported before",
	email: "Matched by email",
	name: "Matched by name",
	system: "Built-in",
} as const satisfies Record<HarvestMatchSource, string>;

/** A long list shows this many rows, and says how many it left out. */
const SHOW = 300;

const TABS = ["people", "projects", "clients", "tasks", "time"] as const;

type Tab = (typeof TABS)[number];

const hours = (seconds: number) =>
	`${(seconds / 3600).toLocaleString("en-US", { maximumFractionDigits: 2 })} h`;

const count = (n: number) => n.toLocaleString("en-US");

function Choice<V extends string>({
	value,
	items,
	onChange,
	disabled,
	className,
}: {
	value: V;
	items: readonly { value: V; label: string }[];
	onChange: (value: V) => void;
	disabled?: boolean;
	className?: string;
}) {
	return (
		<Select
			value={value}
			items={items}
			disabled={disabled}
			onValueChange={(next) => {
				// Resolved against the list, so the union comes from the options
				// rather than from an assertion about what the widget handed back.
				const picked = items.find((item) => item.value === next);

				if (picked) onChange(picked.value);
			}}
		>
			<SelectTrigger className={cn("h-7 w-32 text-xs", className)}>
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{items.map((item) => (
					<SelectItem key={item.value} value={item.value}>
						{item.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

function More({ total }: { total: number }) {
	if (total <= SHOW) return null;

	return (
		<p className="mt-3 text-sm text-muted-foreground">
			The list shows {SHOW} of {count(total)}.
		</p>
	);
}

function Status({ archived }: { archived: boolean }) {
	return (
		<StatusPill tone={archived ? "neutral" : "positive"}>
			{archived ? "Archived" : "Active"}
		</StatusPill>
	);
}

function Empty({ children }: { children: React.ReactNode }) {
	return <p className="text-sm text-muted-foreground">{children}</p>;
}

/**
 * The review step: what the files hold, what the import will do with them,
 * and every choice the admin can change. Each change re-plans in the Worker;
 * this component only draws the plan it is given.
 */
export function HarvestReview({
	plan,
	snapshot,
	choices,
	onChoices,
}: {
	plan: HarvestPlanView;
	snapshot: HarvestSnapshot;
	choices: HarvestChoices;
	onChoices: (choices: HarvestChoices) => void;
}) {
	const [tab, setTab] = useState<Tab>("people");
	const { review } = plan;
	const s = review.summary;

	const setPerson = (key: string, patch: HarvestPersonChoice) =>
		onChoices({
			...choices,
			people: {
				...choices.people,
				[key]: { ...choices.people[key], ...patch },
			},
		});

	const setClient = (key: string, choice: HarvestClientChoice) =>
		onChoices({ ...choices, clients: { ...choices.clients, [key]: choice } });

	const clientItems = [
		{ value: "create", label: "Create" },
		{ value: "internal", label: "Our internal client" },
		...snapshot.clients.map((c) => ({
			value: `match:${c.id}`,
			label: `Use ${c.name}`,
		})),
	];

	const tabLabel = {
		people: `People ${review.people.length}`,
		projects: `Projects ${review.projects.length}`,
		clients: `Clients ${review.clients.length}`,
		tasks: `Tasks ${review.tasks.length}`,
		time: "Time",
	} satisfies Record<Tab, string>;

	return (
		<>
			{plan.blocked.length > 0 && (
				<PageSection
					title="Fix these before the import"
					description="The import cannot start while one of these stays."
				>
					<ul className="flex flex-col gap-2">
						{plan.blocked.map((b) => (
							<li
								key={`${b.kind}:${b.sourceKey}:${b.message}`}
								className="rounded-md bg-warn/12 px-3 py-2 text-sm text-warn"
							>
								{b.message}
							</li>
						))}
					</ul>
				</PageSection>
			)}

			{(review.duplicates.length > 0 || review.negativeRows.length > 0) && (
				<PageSection
					title="Answer these"
					description="The files hold data that the import cannot decide about alone."
				>
					<SettingList>
						{review.duplicates.map((g) => (
							<SettingRow
								key={g.key}
								title={g.people.map((p) => p.name).join(" / ")}
								description={`These names are the same without accents and punctuation. ${g.people
									.map(
										(p) =>
											`${p.name}: ${count(p.rows)} rows, ${p.firstDate ?? "?"} to ${p.lastDate ?? "?"}${p.listed ? ", on the people list" : ""}.`,
									)
									.join(" ")}`}
								action={
									<Choice
										className="w-72"
										value={g.decision ?? UNDECIDED}
										items={[
											{ value: UNDECIDED, label: "Choose an answer" },
											...g.people.map((p) => ({
												value: p.sourceKey,
												label: `One person: ${p.name}`,
											})),
											{ value: "separate", label: "Different people" },
										]}
										onChange={(value) => {
											if (value === UNDECIDED) return;
											onChoices({
												...choices,
												duplicates: { ...choices.duplicates, [g.key]: value },
											});
										}}
									/>
								}
							/>
						))}
						{review.negativeRows.length > 0 && (
							<SettingRow
								title={`${count(review.negativeRows.length)} rows with negative hours`}
								description="Harvest keeps a correction as a negative row. Subtract takes its hours off the row of the same person, day, project and task. Leave them out imports the other rows as they are."
								action={
									<Choice
										className="w-72"
										value={choices.negativeRows ?? UNDECIDED}
										items={NEGATIVE_ITEMS}
										onChange={(value) => {
											if (value === UNDECIDED) return;
											onChoices({ ...choices, negativeRows: value });
										}}
									/>
								}
							/>
						)}
					</SettingList>
					{review.negativeRows.length > 0 && (
						<div className="mt-6">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Date</TableHead>
										<TableHead>Person</TableHead>
										<TableHead>Project</TableHead>
										<TableHead>Task</TableHead>
										<TableHead className="text-right">Hours</TableHead>
										<TableHead>Subtracts from</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{review.negativeRows.slice(0, SHOW).map((n) => (
										<TableRow key={n.record}>
											<TableCell className="mono">{n.date}</TableCell>
											<TableCell>{n.person}</TableCell>
											<TableCell className="text-muted-foreground">
												{n.client} / {n.project}
											</TableCell>
											<TableCell>{n.task}</TableCell>
											<TableCell className="mono text-right">
												{n.hours}
											</TableCell>
											<TableCell>
												{n.against === null ? (
													<span className="text-warn">No matching row</span>
												) : (
													<span className="mono">{n.against} h</span>
												)}
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
							<More total={review.negativeRows.length} />
						</div>
					)}
				</PageSection>
			)}

			<PageSection title="Files">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>File</TableHead>
							<TableHead>Kind</TableHead>
							<TableHead className="text-right">Rows</TableHead>
							<TableHead>Used</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{review.files.map((f) => (
							<TableRow key={f.name}>
								<TableCell className="font-medium">{f.name}</TableCell>
								<TableCell className="text-muted-foreground">
									{f.kind}
								</TableCell>
								<TableCell className="mono text-right">
									{count(f.rows)}
								</TableCell>
								<TableCell>
									{f.used ? (
										<StatusPill tone="positive">Used</StatusPill>
									) : (
										<span className="text-sm text-muted-foreground">
											Not used: {f.reason}
										</span>
									)}
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</PageSection>

			<PageSection title="Settings">
				<SettingList>
					<SettingRow
						title="Cutoff date"
						description="Work before this day comes from Harvest. From this day on, people log their work here. Absence comes from Harvest on every date."
						action={
							<DatePicker
								aria-label="Cutoff date"
								className="w-48"
								value={choices.cutoffDate}
								onValueChange={(next) => {
									if (next) onChoices({ ...choices, cutoffDate: next });
								}}
							/>
						}
					/>
					<SettingRow
						title="Days with work in both"
						description="A day where Harvest has work for a person, and this app has work for the same person too. You can change each day on the Time tab."
						action={
							<Choice
								className="w-52"
								value={choices.overlap.default}
								items={OVERLAP_ITEMS}
								onChange={(value) =>
									onChoices({
										...choices,
										overlap: { ...choices.overlap, default: value },
									})
								}
							/>
						}
					/>
					{review.secondImport.removedDays.length > 0 && (
						<SettingRow
							title="This file is a full export"
							description={`${count(review.secondImport.removedDays.length)} days that an earlier import brought in are not in this file. Turn this on only when the file is a full export: the import then deletes those days.`}
							action={
								<Switch
									aria-label="This file is a full export"
									checked={choices.confirmFullExport}
									onCheckedChange={(on) =>
										onChoices({ ...choices, confirmFullExport: on })
									}
								/>
							}
						/>
					)}
				</SettingList>
			</PageSection>

			<PageSection title="Summary">
				<div className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-4">
					<Metric
						size={24}
						value={count(s.rowsImported)}
						label={`Rows to import, of ${count(s.rowsInFile)}`}
					/>
					<Metric size={24} value={count(s.newDays)} label="New days" />
					<Metric size={24} value={count(s.changedDays)} label="Changed days" />
					<Metric
						size={24}
						value={count(s.unchangedDays)}
						label="Days already imported"
					/>
					<Metric
						size={24}
						value={count(s.overlapDays)}
						label="Days with work in both"
					/>
					<Metric
						size={24}
						value={count(s.skippedDuplicate)}
						label="Rows already here"
					/>
					<Metric
						size={24}
						value={count(s.attentionRows)}
						label="Rows that need attention"
					/>
					<Metric
						size={24}
						value={hours(s.roundingDeltaSeconds)}
						label="Change from quarter-hour rounding"
					/>
				</div>
			</PageSection>

			<PageSection
				title="Review"
				action={
					<SegmentedControl>
						{TABS.map((t) => (
							<SegmentedControlItem
								key={t}
								active={tab === t}
								onClick={() => setTab(t)}
							>
								{tabLabel[t]}
							</SegmentedControlItem>
						))}
					</SegmentedControl>
				}
			>
				{tab === "people" && (
					<>
						<p className="mb-4 max-w-[68ch] text-sm text-muted-foreground">
							A new person with an address from the Harvest people list, or an
							address you type here, can sign in with Google at once. A guessed
							address stays unconfirmed: that person can sign in only after an
							admin confirms it on the People page.
						</p>
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Person</TableHead>
									<TableHead>Email</TableHead>
									<TableHead>Match</TableHead>
									<TableHead>Role</TableHead>
									<TableHead>Type</TableHead>
									<TableHead>Status</TableHead>
									<TableHead className="text-right">Rows</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{review.people.slice(0, SHOW).map((p) => (
									<TableRow key={p.sourceKey}>
										<TableCell className="font-medium">
											{p.name}
											{p.aliases.length > 0 && (
												<span className="block text-xs font-normal text-muted-foreground">
													Also: {p.aliases.join(", ")}
												</span>
											)}
											{p.blocked && (
												<span className="mt-1 block text-xs font-normal text-destructive">
													{p.blocked}
												</span>
											)}
										</TableCell>
										<TableCell>
											{p.action === "create" ? (
												<div className="flex items-center gap-2">
													<Input
														// Re-keyed on the planned address, so a re-plan that
														// changed it redraws the field instead of keeping text
														// the admin never typed.
														key={`${p.sourceKey}:${p.email}`}
														defaultValue={p.email}
														aria-label={`Email for ${p.name}`}
														className="h-7 w-60 text-xs"
														onBlur={(event) => {
															const next = event.target.value
																.trim()
																.toLowerCase();

															if (next && next !== p.email) {
																setPerson(p.sourceKey, { email: next });
															}
														}}
													/>
													{p.emailGuessed && (
														<StatusPill tone="warning">Guess</StatusPill>
													)}
												</div>
											) : (
												<span className="text-sm">{p.email}</span>
											)}
										</TableCell>
										<TableCell className="text-muted-foreground">
											{p.matchedBy ? MATCHED_BY[p.matchedBy] : "New"}
										</TableCell>
										<TableCell>
											{p.action === "create" && p.role ? (
												<Choice
													className="w-28"
													value={p.role}
													items={ROLE_ITEMS}
													onChange={(role) => setPerson(p.sourceKey, { role })}
												/>
											) : (
												<span className="text-faint">—</span>
											)}
										</TableCell>
										<TableCell>
											{p.action === "create" && p.type ? (
												<Choice
													value={p.type}
													items={TYPE_ITEMS}
													onChange={(type) => setPerson(p.sourceKey, { type })}
												/>
											) : (
												<span className="text-faint">—</span>
											)}
										</TableCell>
										<TableCell>
											<Status archived={p.archived} />
										</TableCell>
										<TableCell className="mono text-right">
											{count(p.rows)}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
						<More total={review.people.length} />
					</>
				)}

				{tab === "projects" && (
					<>
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Client</TableHead>
									<TableHead>Project</TableHead>
									<TableHead>Code</TableHead>
									<TableHead className="text-right">Hours</TableHead>
									<TableHead className="text-right">Billable</TableHead>
									<TableHead className="text-right">Non-billable</TableHead>
									<TableHead>Type</TableHead>
									<TableHead>Status</TableHead>
									<TableHead className="text-right">Budget</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{review.projects.slice(0, SHOW).map((p) => (
									<TableRow key={p.sourceKey}>
										<TableCell className="text-muted-foreground">
											{p.client}
										</TableCell>
										<TableCell className="font-medium">
											{p.name}
											{p.matchedBy && (
												<span className="block text-xs font-normal text-muted-foreground">
													{MATCHED_BY[p.matchedBy]}
												</span>
											)}
										</TableCell>
										<TableCell className="mono">{p.code ?? "—"}</TableCell>
										<TableCell className="mono text-right">
											{hours(p.seconds)}
										</TableCell>
										<TableCell className="mono text-right">
											{hours(p.billableSeconds)}
										</TableCell>
										<TableCell className="mono text-right">
											{hours(p.nonBillableSeconds)}
										</TableCell>
										<TableCell>
											{p.action === "create" ? (
												<Choice
													value={p.type ?? p.suggestedType}
													items={PROJECT_TYPE_ITEMS}
													onChange={(type) =>
														onChoices({
															...choices,
															projectTypes: {
																...choices.projectTypes,
																[p.sourceKey]: type,
															},
														})
													}
												/>
											) : (
												<span className="text-sm text-muted-foreground">
													{PROJECT_TYPE_ITEMS.find((t) => t.value === p.type)
														?.label ?? "—"}
												</span>
											)}
										</TableCell>
										<TableCell>
											<Status archived={p.status === "archived"} />
										</TableCell>
										<TableCell className="mono text-right">
											{p.budgetSeconds ? hours(p.budgetSeconds) : "—"}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
						<More total={review.projects.length} />
					</>
				)}

				{tab === "clients" && (
					<>
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Client</TableHead>
									<TableHead>In this app</TableHead>
									<TableHead>Status</TableHead>
									<TableHead className="text-right">Projects</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{review.clients.slice(0, SHOW).map((c) => (
									<TableRow key={c.sourceKey}>
										<TableCell className="font-medium">{c.name}</TableCell>
										<TableCell>
											{c.matchedBy === "earlier_import" ? (
												<span className="text-sm text-muted-foreground">
													{MATCHED_BY.earlier_import}
												</span>
											) : (
												<Choice
													className="w-56"
													value={
														c.action === "match" && c.localId
															? `match:${c.localId}`
															: c.action
													}
													items={clientItems}
													onChange={(value) => {
														if (value === "create" || value === "internal") {
															setClient(c.sourceKey, { action: value });
														} else {
															setClient(c.sourceKey, {
																action: "match",
																localId: value.slice("match:".length),
															});
														}
													}}
												/>
											)}
										</TableCell>
										<TableCell>
											<Status archived={c.archived} />
										</TableCell>
										<TableCell className="mono text-right">
											{count(c.projects)}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
						<More total={review.clients.length} />
					</>
				)}

				{tab === "tasks" && (
					<>
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Task</TableHead>
									<TableHead>Names in Harvest</TableHead>
									<TableHead>Match</TableHead>
									<TableHead>Status</TableHead>
									<TableHead className="text-right">Rows</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{review.tasks.slice(0, SHOW).map((t) => (
									<TableRow key={t.sourceKey}>
										<TableCell className="font-medium">{t.name}</TableCell>
										<TableCell className="text-muted-foreground">
											{t.harvestNames.join(", ")}
										</TableCell>
										<TableCell className="text-muted-foreground">
											{t.matchedBy ? MATCHED_BY[t.matchedBy] : "New"}
										</TableCell>
										<TableCell>
											<Status archived={t.archived} />
										</TableCell>
										<TableCell className="mono text-right">
											{count(t.rows)}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
						<More total={review.tasks.length} />
					</>
				)}

				{tab === "time" && (
					<div className="flex flex-col gap-10">
						<div className="grid gap-8 sm:grid-cols-2">
							<div>
								<h3 className="eyebrow mb-3">Hours for each year</h3>
								<Table>
									<TableBody>
										{s.secondsPerYear.map((y) => (
											<TableRow key={y.year}>
												<TableCell className="mono">{y.year}</TableCell>
												<TableCell className="mono text-right">
													{hours(y.seconds)}
												</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							</div>
							<div>
								<h3 className="eyebrow mb-3">Rows left out</h3>
								<Table>
									<TableBody>
										<TableRow>
											<TableCell>Already here</TableCell>
											<TableCell className="mono text-right">
												{count(s.skippedDuplicate)}
											</TableCell>
										</TableRow>
										<TableRow>
											<TableCell>On a day with work in both</TableCell>
											<TableCell className="mono text-right">
												{count(s.skippedOverlap)}
											</TableCell>
										</TableRow>
										<TableRow>
											<TableCell>On or after the cutoff</TableCell>
											<TableCell className="mono text-right">
												{count(s.skippedByCutoff)}
											</TableCell>
										</TableRow>
										<TableRow>
											<TableCell>
												Imported before, and not changed here
											</TableCell>
											<TableCell className="mono text-right">
												{count(s.rowsAlreadyImported)}
											</TableCell>
										</TableRow>
										<TableRow>
											<TableCell>Need attention</TableCell>
											<TableCell className="mono text-right">
												{count(s.attentionRows)}
											</TableCell>
										</TableRow>
									</TableBody>
								</Table>
							</div>
						</div>

						<div>
							<h3 className="eyebrow mb-3">Days with work in both</h3>
							{review.overlapDays.length === 0 ? (
								<Empty>No day has work in both.</Empty>
							) : (
								<>
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead>Person</TableHead>
												<TableHead>Date</TableHead>
												<TableHead className="text-right">Harvest</TableHead>
												<TableHead className="text-right">This app</TableHead>
												<TableHead>Keep</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{review.overlapDays.slice(0, SHOW).map((d) => (
												<TableRow key={d.dayKey}>
													<TableCell className="font-medium">
														{d.person}
													</TableCell>
													<TableCell className="mono">{d.date}</TableCell>
													<TableCell className="mono text-right">
														{hours(d.harvestSeconds)}
													</TableCell>
													<TableCell className="mono text-right">
														{hours(d.appSeconds)}
														{d.automationOnly && (
															<span className="block text-xs text-muted-foreground">
																Automation only
															</span>
														)}
													</TableCell>
													<TableCell>
														<Choice
															className="w-52"
															value={d.decision}
															items={OVERLAP_ITEMS}
															onChange={(value) =>
																onChoices({
																	...choices,
																	overlap: {
																		...choices.overlap,
																		days: {
																			...choices.overlap.days,
																			[d.dayKey]: value,
																		},
																	},
																})
															}
														/>
													</TableCell>
												</TableRow>
											))}
										</TableBody>
									</Table>
									<More total={review.overlapDays.length} />
								</>
							)}
						</div>

						{review.absenceConflicts.length > 0 && (
							<div>
								<h3 className="eyebrow mb-3">Absence booked differently</h3>
								<p className="mb-3 text-sm text-muted-foreground">
									This app already has a different absence on these days. The
									import keeps the one here.
								</p>
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>Person</TableHead>
											<TableHead>Date</TableHead>
											<TableHead>Harvest</TableHead>
											<TableHead>This app</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{review.absenceConflicts.slice(0, SHOW).map((a) => (
											<TableRow key={`${a.personSourceKey}:${a.date}`}>
												<TableCell className="font-medium">
													{a.person}
												</TableCell>
												<TableCell className="mono">{a.date}</TableCell>
												<TableCell>{a.harvestTask}</TableCell>
												<TableCell>{a.appTask}</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
								<More total={review.absenceConflicts.length} />
							</div>
						)}

						<div>
							<h3 className="eyebrow mb-3">Rows that need attention</h3>
							{review.attention.length === 0 ? (
								<Empty>Every row can be imported.</Empty>
							) : (
								<>
									<p className="mb-3 text-sm text-muted-foreground">
										The import leaves these rows out. Fix them in Harvest and
										export again, or add them here by hand.
									</p>
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead>Date</TableHead>
												<TableHead>Person</TableHead>
												<TableHead>Project</TableHead>
												<TableHead>Task</TableHead>
												<TableHead className="text-right">Hours</TableHead>
												<TableHead>Problem</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{review.attention.slice(0, SHOW).map((a) => (
												<TableRow key={a.record}>
													<TableCell className="mono">{a.date}</TableCell>
													<TableCell>{a.person}</TableCell>
													<TableCell className="text-muted-foreground">
														{a.client} / {a.project}
													</TableCell>
													<TableCell>{a.task}</TableCell>
													<TableCell className="mono text-right">
														{a.hours}
													</TableCell>
													<TableCell className="text-warn">
														{a.reason}
													</TableCell>
												</TableRow>
											))}
										</TableBody>
									</Table>
									<More total={review.attention.length} />
								</>
							)}
						</div>

						{(review.secondImport.changedDays.length > 0 ||
							review.secondImport.keptDays.length > 0 ||
							review.secondImport.removedDays.length > 0) && (
							<div>
								<h3 className="eyebrow mb-3">
									Days an earlier import brought in
								</h3>
								<Table>
									<TableBody>
										<TableRow>
											<TableCell>
												Changed in Harvest: the import replaces them
											</TableCell>
											<TableCell className="mono text-right">
												{count(review.secondImport.changedDays.length)}
											</TableCell>
										</TableRow>
										<TableRow>
											<TableCell>
												Changed in Harvest and edited here: the import keeps
												them
											</TableCell>
											<TableCell className="mono text-right">
												{count(review.secondImport.keptDays.length)}
											</TableCell>
										</TableRow>
										<TableRow>
											<TableCell>
												Not in this file:{" "}
												{choices.confirmFullExport
													? "the import deletes them"
													: "the import keeps them"}
											</TableCell>
											<TableCell className="mono text-right">
												{count(review.secondImport.removedDays.length)}
											</TableCell>
										</TableRow>
									</TableBody>
								</Table>
							</div>
						)}
					</div>
				)}
			</PageSection>
		</>
	);
}
