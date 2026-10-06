import type { DaySuggestion } from "@farmer/api-client";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { View } from "react-native";

import { useApplyDayAssembly, useDayAssembly } from "../../src/api/day";
import { ProjectPicker, TaskPicker } from "../../src/forms/pickers";
import { Sheet } from "../../src/forms/sheet";
import { formatHours } from "../../src/lib/duration";
import {
	applyBody,
	type AssemblyPick,
	assemblyMessage,
	defaultSelection,
	missingSources,
	suggestionSource,
	suggestionTitle,
} from "../../src/time/assembly";
import { CheckRow } from "../../src/time/components/check-row";
import { type Notice, Snackbar } from "../../src/time/components/snackbar";
import { SwitchRow } from "../../src/time/components/switch-row";
import { committed } from "../../src/time/haptics";
import { sumSeconds } from "../../src/time/seconds";
import {
	ActionButton,
	EmptyState,
	ErrorState,
	IconButton,
	Skeleton,
	Text,
} from "../../src/ui/components";
import { messageOf } from "../../src/ui/errors";
import { Icon } from "../../src/ui/icon";
import type { IconName } from "../../src/ui/icons";
import { usePalette } from "../../src/ui/theme";
import { SPACE } from "../../src/ui/type";

type Params = { date: string };

const longDay = (day: string) =>
	new Intl.DateTimeFormat(undefined, {
		weekday: "long",
		day: "numeric",
		month: "long",
		year: "numeric",
		timeZone: "UTC",
	}).format(new Date(`${day}T12:00:00Z`));

const iconOf = (kind: string): IconName => {
	switch (kind) {
		case "meeting":
			return "meeting";
		case "work":
			return "commit";
		case "review":
			return "pullRequest";
		case "break":
			return "coffee";
		default:
			return "calendar";
	}
};

/** What the person changed, kept with the answer it was made on. A new
 *  answer starts again from its own defaults. */
type Choices = {
	stamp: number;
	keys: ReadonlySet<string>;
	picks: ReadonlyMap<string, AssemblyPick>;
};

/**
 * "Assemble my day": the entries the day is missing, from the calendar,
 * GitHub and the working hours. The suggestions arrive ticked, except the
 * ones the person deleted before, and each one can go to another project or
 * task before it is added.
 */
export default function AssembleSheet() {
	const params = useLocalSearchParams<Params>();
	const date = params.date;
	const palette = usePalette();
	const router = useRouter();
	// For this opening only: a switch that stays on offers each deletion
	// again on every day.
	const [includeDismissed, setIncludeDismissed] = useState(false);
	const assembly = useDayAssembly(date, includeDismissed);
	const apply = useApplyDayAssembly();
	const [choices, setChoices] = useState<Choices | null>(null);
	const [open, setOpen] = useState<string | null>(null);
	const [notice, setNotice] = useState<Notice | null>(null);
	const hideNotice = useCallback(() => setNotice(null), []);

	const data = assembly.data;
	const suggestions = data?.suggestions ?? [];
	const stamp = assembly.dataUpdatedAt;
	const current: Choices =
		choices && choices.stamp === stamp
			? choices
			: { stamp, keys: defaultSelection(suggestions), picks: new Map() };
	const pickFor = (s: DaySuggestion): AssemblyPick =>
		current.picks.get(s.key) ?? { projectId: s.projectId, taskId: s.taskId };
	const setPick = (s: DaySuggestion, next: Partial<AssemblyPick>) =>
		setChoices({
			...current,
			picks: new Map(current.picks).set(s.key, { ...pickFor(s), ...next }),
		});
	const toggle = (key: string) => {
		const keys = new Set(current.keys);
		if (keys.has(key)) keys.delete(key);
		else keys.add(key);
		setChoices({ ...current, keys });
	};

	const chosen = suggestions.filter((s) => current.keys.has(s.key));
	const chosenSeconds = sumSeconds(chosen);
	const missing = data ? missingSources(data.sources) : [];

	const add = () => {
		if (chosen.length === 0) return;
		apply.mutate(applyBody(date, chosen, pickFor), {
			onSuccess: (result) => {
				const { message, warning } = assemblyMessage(result);
				if (!warning) {
					committed();
					router.back();
					return;
				}
				// Some entries were not made. The sheet stays open with the
				// reason, and the list reads again without the ones made.
				setNotice({ id: Date.now(), tone: "warning", message });
			},
			onError: (error) =>
				setNotice({
					id: Date.now(),
					tone: "warning",
					message: messageOf(error) ?? "Could not assemble the day.",
				}),
		});
	};

	const actionLabel =
		chosen.length === 0
			? "Add"
			: `Add ${chosen.length} ${chosen.length === 1 ? "block" : "blocks"}`;

	return (
		<View style={{ flex: 1 }}>
			<Sheet
				title="Assemble my day"
				actionLabel={actionLabel}
				onAction={add}
				busy={apply.isPending}
				actionDisabled={chosen.length === 0}
			>
				<Text variant="bodyMedium" color={palette.onSurfaceVariant}>
					{longDay(date)}
					{data
						? `. ${formatHours(data.loggedSeconds)} logged of ${formatHours(data.targetSeconds)} target.`
						: ""}
				</Text>
				{assembly.isPending ? (
					<>
						<Text variant="bodyMedium" color={palette.onSurfaceVariant}>
							Reading your calendar, commits and working hours.
						</Text>
						<Skeleton height={168} radius={16} />
					</>
				) : assembly.isError ? (
					<ErrorState
						error={assembly.error}
						onRetry={() => void assembly.refetch()}
					/>
				) : suggestions.length === 0 ? (
					<EmptyState
						icon="check"
						title="Nothing to add"
						message={
							(data?.dismissedCount ?? 0) > 0
								? "Nothing new to add, but this day has blocks you deleted."
								: "This day already matches your working hours."
						}
					/>
				) : (
					<View
						style={{
							borderRadius: 16,
							overflow: "hidden",
							backgroundColor: palette.surfaceContainer,
						}}
					>
						{suggestions.map((s, index) => (
							<SuggestionRow
								key={s.key}
								suggestion={s}
								first={index === 0}
								checked={current.keys.has(s.key)}
								pick={pickFor(s)}
								open={open === s.key}
								onToggle={() => toggle(s.key)}
								onToggleOpen={() => setOpen(open === s.key ? null : s.key)}
								onPick={(next) => setPick(s, next)}
							/>
						))}
					</View>
				)}
				{assembly.isSuccess && data && data.dismissedCount > 0 ? (
					<SwitchRow
						title="Also offer things I deleted"
						description={
							data.dismissedCount === 1
								? "1 block deleted on this day. It does not come back on its own."
								: `${data.dismissedCount} blocks deleted on this day. They do not come back on their own.`
						}
						value={includeDismissed}
						onValueChange={setIncludeDismissed}
					/>
				) : null}
				{assembly.isSuccess && missing.length > 0 ? (
					<View style={{ gap: SPACE.s, alignItems: "flex-start" }}>
						<Text variant="bodyMedium" color={palette.onSurfaceVariant}>
							{missing.join(" and ")} not connected. Connect{" "}
							{missing.length === 1 ? "it" : "them"} for better suggestions.
						</Text>
						<ActionButton
							label="Open your integrations"
							variant="text"
							onPress={() => {
								router.back();
								router.push("/you/integrations");
							}}
						/>
					</View>
				) : null}
				{chosen.length > 0 ? (
					<Text variant="labelLarge" numeric>
						{formatHours(chosenSeconds)} selected
					</Text>
				) : null}
				{/* Room for the snackbar over the end of the list. */}
				<View style={{ height: SPACE.xxl * 2 }} />
			</Sheet>
			<Snackbar notice={notice} onHide={hideNotice} floating />
		</View>
	);
}

function SuggestionRow({
	suggestion: s,
	first,
	checked,
	pick,
	open,
	onToggle,
	onToggleOpen,
	onPick,
}: {
	suggestion: DaySuggestion;
	first: boolean;
	checked: boolean;
	pick: AssemblyPick;
	open: boolean;
	onToggle: () => void;
	onToggleOpen: () => void;
	onPick: (next: Partial<AssemblyPick>) => void;
}) {
	const palette = usePalette();
	const title = suggestionTitle(s);
	const length = s.fillsDay
		? `Fills the rest of the day, about ${formatHours(s.durationSeconds)}`
		: formatHours(s.durationSeconds);
	const source = suggestionSource(s);
	return (
		<View
			style={{
				borderTopWidth: first ? 0 : 1,
				borderTopColor: palette.outlineVariant,
			}}
		>
			<View style={{ flexDirection: "row", alignItems: "center" }}>
				<CheckRow
					checked={checked}
					onPress={onToggle}
					label={[title, s.dismissed ? "deleted earlier" : "", length, source]
						.filter((part) => part)
						.join(", ")}
				>
					<View style={{ flexDirection: "row", gap: SPACE.m }}>
						<View style={{ paddingTop: 2 }}>
							<Icon
								name={iconOf(s.kind)}
								size={20}
								color={palette.onSurfaceVariant}
							/>
						</View>
						<View style={{ flex: 1, gap: 2 }}>
							<Text variant="bodyLarge" numberOfLines={1}>
								{title}
							</Text>
							{s.dismissed ? (
								<Text variant="bodySmall" color={palette.onSurfaceVariant}>
									Deleted earlier
								</Text>
							) : null}
							<Text variant="bodyMedium" color={palette.onSurfaceVariant}>
								{length}
							</Text>
							<Text
								variant="bodySmall"
								color={palette.onSurfaceVariant}
								numberOfLines={2}
							>
								{source}
							</Text>
							{s.kind === "work" && s.description ? (
								<Text
									variant="bodySmall"
									color={palette.onSurfaceVariant}
									numberOfLines={2}
								>
									{s.description}
								</Text>
							) : null}
						</View>
					</View>
				</CheckRow>
				<IconButton
					icon={open ? "collapse" : "expand"}
					label={
						open
							? `Hide the project and task of ${title}`
							: `Change the project or task of ${title}`
					}
					onPress={onToggleOpen}
				/>
			</View>
			{open ? (
				<View
					style={{
						gap: SPACE.m,
						paddingHorizontal: SPACE.l,
						paddingBottom: SPACE.l,
					}}
				>
					<ProjectPicker
						value={pick.projectId}
						onChange={(projectId) => onPick({ projectId })}
					/>
					<TaskPicker
						value={pick.taskId}
						onChange={(task) => onPick({ taskId: task.id })}
					/>
				</View>
			) : null}
		</View>
	);
}
