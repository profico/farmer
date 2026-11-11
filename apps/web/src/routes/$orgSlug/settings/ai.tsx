import { resolveReportPeriod } from "@farmer/core/lib/report-period";
import { matchesSearch } from "@farmer/core/lib/search";
import { MAX_SYSTEM_PROMPT_CHARS } from "@farmer/core/schema";
import type {
	AssistantUsageModel,
	AssistantUsagePerson,
} from "@farmer/core/services";
import { SparkleIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { PersonAvatar } from "#/components/person-avatar.tsx";
import { periodSearch } from "#/components/reports/search.ts";
import { PeriodPicker } from "#/components/reports/shared.tsx";
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
import {
	Combobox,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxItem,
	ComboboxList,
	ComboboxTrigger,
	ComboboxValue,
} from "#/components/ui/combobox.tsx";
import { Input } from "#/components/ui/input.tsx";
import {
	Page,
	PageHeader,
	PageSection,
	SettingList,
	SettingRow,
} from "#/components/ui/page-header.tsx";
import { StatTile, StatTiles } from "#/components/ui/stat-tile.tsx";
import { Switch } from "#/components/ui/switch.tsx";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table.tsx";
import { Textarea } from "#/components/ui/textarea.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { useToday } from "#/hooks/use-today.ts";
import { useWeekStartsOn } from "#/hooks/use-week-starts-on.ts";
import {
	assistantModelsQuery,
	assistantSettingsQuery,
	assistantUsageQuery,
} from "#/queries/assistant.ts";
import { queryKeys } from "#/queries/keys.ts";
import {
	disconnectAssistant,
	setAssistantSettings,
	updateAssistantSettings,
} from "#/server/assistant.ts";
import { requireOrgAdmin } from "#/server/auth.ts";

// The assistant's settings and what its answers cost. One OpenRouter account
// per organization, set by an admin, so the page is admin only.

export const Route = createFileRoute("/$orgSlug/settings/ai")({
	validateSearch: z.object(periodSearch),
	beforeLoad: async () => {
		await requireOrgAdmin();
	},
	component: AiSettingsPage,
});

function AiSettingsPage() {
	const { assistantEnabled } = Route.useRouteContext();

	return (
		<Page>
			<PageHeader eyebrow={<SettingsEyebrow />} title="AI" />
			{/* Behind the deployment's `ASSISTANT_ENABLED` switch: the services
			    refuse to store a key while the feature is off. */}
			{assistantEnabled ? (
				<>
					<OpenRouterSection />
					<UsageSection />
				</>
			) : (
				<PageSection>
					<p className="text-sm text-muted-foreground">
						The Assistant is turned off for this deployment.
					</p>
				</PageSection>
			)}
		</Page>
	);
}

/** House rules for the system prompt. Explicit save: the switches write on change. */
function HouseRulesRow({ stored }: { stored: string }) {
	const orgSlug = useOrgSlug();
	const queryClient = useQueryClient();
	const [draft, setDraft] = useState(stored);
	// Re-seed on a server change, but only while the box is clean.
	const [baseline, setBaseline] = useState(stored);
	if (stored !== baseline && draft === baseline) {
		setBaseline(stored);
		setDraft(stored);
	}
	const dirty = draft !== stored;

	const save = useMutation({
		mutationFn: () =>
			updateAssistantSettings({
				// null clears the rules; undefined leaves them.
				data: { systemPrompt: draft.trim() ? draft.trim() : null },
			}),
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: queryKeys(orgSlug).assistant,
			});
			toast.success("House rules saved");
		},
		onError: (error) => toast.error(error.message ?? "Could not save"),
	});

	return (
		<div className="mt-5 flex flex-col gap-2">
			<div>
				<h3 className="text-sm font-medium">House rules</h3>
				<p className="mt-1 max-w-[68ch] text-sm leading-normal text-muted-foreground">
					Added to the built-in instructions. The built-in ones win a conflict.
				</p>
			</div>
			<Textarea
				value={draft}
				onChange={(event) => setDraft(event.target.value)}
				rows={5}
				maxLength={MAX_SYSTEM_PROMPT_CHARS}
				placeholder={
					"e.g. We bill in 30-minute blocks.\nAlways put internal work on the Internal project."
				}
				aria-label="House rules"
			/>
			<div className="flex items-center gap-3">
				<Button
					disabled={!dirty || save.isPending}
					onClick={() => save.mutate()}
				>
					{save.isPending ? "Saving…" : "Save house rules"}
				</Button>
				<span className="text-2xs text-muted-foreground">
					{draft.length} / {MAX_SYSTEM_PROMPT_CHARS}
				</span>
			</div>
		</div>
	);
}

type ModelItem = { value: string; label: string };

/**
 * The default-model picker: a searching Combobox, as OpenRouter lists hundreds.
 * The search covers the model id, so "anthropic/" lists one vendor. A stored
 * model that the catalogue lacks is added, and the trigger shows its raw id.
 */
function ModelPicker({
	models,
	value,
	onValueChange,
	disabled,
}: {
	models: { id: string; name: string }[];
	/** The stored model id, or "" before one is chosen. */
	value: string;
	onValueChange: (modelId: string) => void;
	disabled?: boolean;
}) {
	const items = useMemo<ModelItem[]>(() => {
		const known = models.map((model) => ({
			value: model.id,
			label: model.name,
		}));
		if (value === "" || known.some((item) => item.value === value))
			return known;
		return [{ value, label: value }, ...known];
	}, [models, value]);

	const [query, setQuery] = useState("");
	const filtered = useMemo(() => {
		if (query.trim() === "") return items;
		return items.filter((item) =>
			matchesSearch(query, [item.label, item.value]),
		);
	}, [items, query]);

	const selected = items.find((item) => item.value === value) ?? null;

	return (
		<Combobox
			items={items}
			filteredItems={filtered}
			value={selected}
			onValueChange={(item: ModelItem | null) => {
				if (item) onValueChange(item.value);
			}}
			isItemEqualToValue={(a: ModelItem, b: ModelItem) => a.value === b.value}
			itemToStringLabel={(item: ModelItem) => item.label}
			inputValue={query}
			onInputValueChange={setQuery}
			onOpenChange={(open) => {
				if (!open) setQuery("");
			}}
			autoHighlight
			disabled={disabled}
		>
			<ComboboxTrigger className="w-64" aria-label="Default model">
				<ComboboxValue placeholder="Pick a model">
					{(item: ModelItem | null) =>
						item ? (
							<span className="truncate">{item.label}</span>
						) : (
							"Pick a model"
						)
					}
				</ComboboxValue>
			</ComboboxTrigger>
			<ComboboxContent searchPlaceholder="Search models…">
				<ComboboxEmpty>No model matches.</ComboboxEmpty>
				<ComboboxList>
					{(item: ModelItem) => (
						<ComboboxItem key={item.value} value={item}>
							<span className="truncate">{item.label}</span>
						</ComboboxItem>
					)}
				</ComboboxList>
			</ComboboxContent>
		</Combobox>
	);
}

// Admin only: `assistantModelsQuery` needs the key, so a loader prefetch would
// 403 for a member. Same shape as SlackSection below.
function OpenRouterSection() {
	const orgSlug = useOrgSlug();
	const queryClient = useQueryClient();
	const { data: settings } = useQuery(assistantSettingsQuery(orgSlug));
	const [apiKey, setApiKey] = useState("");

	const configured = settings?.configured ?? false;
	// The stored key no longer opens (`BETTER_AUTH_SECRET` changed). The admin may disconnect it.
	const unreadable = settings?.keyUnreadable ?? false;

	const invalidate = () =>
		queryClient.invalidateQueries({
			queryKey: queryKeys(orgSlug).assistant,
		});

	// The catalogue call needs the key.
	const { data: models = [] } = useQuery({
		...assistantModelsQuery(orgSlug),
		enabled: configured,
	});

	const connect = useMutation({
		mutationFn: () =>
			setAssistantSettings({
				data: {
					apiKey: apiKey.trim(),
					// A cheap, tool-capable default. The admin may change it below.
					defaultModel: settings?.defaultModel ?? "openai/gpt-4o-mini",
				},
			}),
		onSuccess: async () => {
			setApiKey("");
			await invalidate();
			toast.success("OpenRouter connected");
		},
		onError: (error) =>
			toast.error(error.message ?? "Could not connect OpenRouter"),
	});

	const setModel = useMutation({
		mutationFn: (defaultModel: string) =>
			updateAssistantSettings({ data: { defaultModel } }),
		onSuccess: async () => {
			await invalidate();
			toast.success("Default model updated");
		},
		onError: (error) => toast.error(error.message ?? "Could not update"),
	});

	const toggle = useMutation({
		mutationFn: (enabled: boolean) =>
			updateAssistantSettings({ data: { enabled } }),
		onSuccess: invalidate,
		onError: (error) => toast.error(error.message ?? "Could not update"),
	});

	const disconnect = useMutation({
		mutationFn: () => disconnectAssistant(),
		onSuccess: async () => {
			await invalidate();
			toast.success("OpenRouter disconnected");
		},
		onError: (error) => toast.error(error.message ?? "Could not disconnect"),
	});

	return (
		<PageSection>
			<SettingRow
				icon={<SparkleIcon className="size-5" />}
				title="OpenRouter"
				badge={
					configured ? (
						<Badge variant="secondary">
							{settings?.enabled ? "Connected" : "Paused"}
						</Badge>
					) : (
						unreadable && <Badge variant="destructive">Connect again</Badge>
					)
				}
				description="Powers the Assistant for the whole workspace. Each answer uses only what the asker can see."
				action={
					configured || unreadable ? (
						<AlertDialog>
							<AlertDialogTrigger
								render={
									<Button
										variant="outline"
										className="hover:text-destructive"
										disabled={disconnect.isPending}
									>
										Disconnect
									</Button>
								}
							/>
							<AlertDialogContent>
								<AlertDialogHeader>
									<AlertDialogTitle>Disconnect OpenRouter</AlertDialogTitle>
									<AlertDialogDescription>
										The Assistant stops for everyone. Past conversations stay.
										To revoke the key, use OpenRouter.
									</AlertDialogDescription>
								</AlertDialogHeader>
								<AlertDialogFooter>
									<AlertDialogCancel>Cancel</AlertDialogCancel>
									<AlertDialogAction
										variant="destructive"
										onClick={() => disconnect.mutate()}
									>
										Disconnect
									</AlertDialogAction>
								</AlertDialogFooter>
							</AlertDialogContent>
						</AlertDialog>
					) : null
				}
			/>

			<SettingList className="mt-1">
				<SettingRow
					title={
						configured
							? "Replace the API key"
							: unreadable
								? "Paste the API key again"
								: "API key"
					}
					description={
						configured
							? `Currently ${settings?.keyHint ?? ""}. Pasting a new one replaces it; the old key is not recoverable from here.`
							: unreadable
								? "The stored key can no longer be read, because the server's secret changed after it was saved. The Assistant is off for everyone until a key is saved again — the same one or a new one."
								: "Create a key at openrouter.ai/keys. It is never shown again."
					}
					action={
						<div className="flex items-center gap-2">
							<Input
								type="password"
								value={apiKey}
								onChange={(event) => setApiKey(event.target.value)}
								placeholder="sk-or-v1-…"
								autoComplete="off"
								className="w-56"
								aria-label="OpenRouter API key"
							/>
							<Button
								disabled={connect.isPending || apiKey.trim().length < 20}
								onClick={() => connect.mutate()}
							>
								{connect.isPending ? "Checking…" : "Save"}
							</Button>
						</div>
					}
				/>

				{configured && (
					<SettingRow
						title="Default model"
						description="The default for new conversations. Only models with tool calling are listed."
						action={
							<ModelPicker
								models={models}
								value={settings?.defaultModel ?? ""}
								onValueChange={(modelId) => setModel.mutate(modelId)}
								disabled={setModel.isPending}
							/>
						}
					/>
				)}

				{configured && (
					<SettingRow
						title="Available to the workspace"
						description="Turn off to take the Assistant away without forgetting the key or anybody's history."
						action={
							<Switch
								checked={settings?.enabled ?? false}
								onCheckedChange={(value) => toggle.mutate(value)}
								disabled={toggle.isPending}
							/>
						}
					/>
				)}
			</SettingList>

			{configured && <HouseRulesRow stored={settings?.systemPrompt ?? ""} />}
		</PageSection>
	);
}

const usd = (value: number) =>
	new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: "USD",
		minimumFractionDigits: 2,
		// A small figure keeps its cents of a cent: 0.0042 must not read as 0.00.
		maximumFractionDigits: value > 0 && value < 1 ? 4 : 2,
	}).format(value);

const count = (value: number) => value.toLocaleString("en-US");

function UsageSection() {
	const orgSlug = useOrgSlug();
	const { organization } = Route.useRouteContext();
	const search = Route.useSearch();
	const navigate = useNavigate({ from: "/$orgSlug/settings/ai" });
	const weekStartsOn = useWeekStartsOn();
	const today = useToday(organization.timezone);
	const { from, to } = resolveReportPeriod(search, today, weekStartsOn);
	const { data, isPending } = useQuery(
		assistantUsageQuery(orgSlug, { from, to }),
	);

	return (
		<PageSection
			title="Usage"
			description="What the Assistant cost this workspace in the period. Figures start from the day this page shipped: older answers have no cost."
		>
			<PeriodPicker
				search={search}
				today={today}
				thisMonth={today.slice(0, 7)}
				link={(s) => (
					<Link to="/$orgSlug/settings/ai" params={{ orgSlug }} search={s} />
				)}
				navigateTo={(s) =>
					navigate({
						to: "/$orgSlug/settings/ai",
						params: { orgSlug },
						search: s,
					})
				}
			/>
			{isPending || !data ? (
				<p className="mt-6 text-sm text-muted-foreground">Loading…</p>
			) : (
				<div className="mt-6 flex flex-col gap-8">
					<StatTiles columns={3}>
						<StatTile
							label="Cost"
							value={usd(data.totals.costUsd)}
							caption={
								data.totals.unknownCostCalls > 0
									? `${count(data.totals.unknownCostCalls)} ${data.totals.unknownCostCalls === 1 ? "call" : "calls"} with unknown cost, not in this figure`
									: undefined
							}
						/>
						<StatTile label="Calls" value={count(data.totals.calls)} />
						<StatTile
							label="Tokens"
							value={count(
								data.totals.promptTokens + data.totals.completionTokens,
							)}
						/>
					</StatTiles>
					<PeopleTable rows={data.people} />
					<ModelsTable rows={data.models} />
				</div>
			)}
		</PageSection>
	);
}

function PeopleTable({ rows }: { rows: AssistantUsagePerson[] }) {
	return (
		<div>
			<h3 className="mb-2 text-sm font-medium">By person</h3>
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Person</TableHead>
						<TableHead className="text-right">Calls</TableHead>
						<TableHead className="text-right">Tokens</TableHead>
						<TableHead className="text-right">Cost</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{rows.length === 0 && (
						<TableRow>
							<TableCell colSpan={4} className="text-muted-foreground">
								No calls in this period.
							</TableCell>
						</TableRow>
					)}
					{rows.map((row) => (
						<TableRow key={row.userId}>
							<TableCell>
								<span className="flex items-center gap-2">
									<PersonAvatar
										name={row.name}
										userId={row.userId}
										image={row.image}
										size="sm"
									/>
									{row.name}
								</span>
							</TableCell>
							<TableCell className="text-right tabular-nums">
								{count(row.calls)}
							</TableCell>
							<TableCell className="text-right tabular-nums">
								{count(row.promptTokens + row.completionTokens)}
							</TableCell>
							<TableCell className="text-right tabular-nums">
								{usd(row.costUsd)}
								{row.unknownCostCalls > 0 && (
									<span className="ml-1 text-2xs text-muted-foreground">
										+ {row.unknownCostCalls} unknown
									</span>
								)}
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	);
}

function ModelsTable({ rows }: { rows: AssistantUsageModel[] }) {
	if (rows.length === 0) return null;
	return (
		<div>
			<h3 className="mb-2 text-sm font-medium">By model</h3>
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Model</TableHead>
						<TableHead className="text-right">Calls</TableHead>
						<TableHead className="text-right">Cost</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{rows.map((row) => (
						<TableRow key={row.model}>
							<TableCell className="truncate">{row.model}</TableCell>
							<TableCell className="text-right tabular-nums">
								{count(row.calls)}
							</TableCell>
							<TableCell className="text-right tabular-nums">
								{usd(row.costUsd)}
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	);
}
