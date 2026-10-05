import type { FilingRule } from "@farmer/api-client";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Alert, View } from "react-native";

import {
	useDeleteFilingRule,
	useFilingRules,
	useUpdateFilingRule,
} from "../../src/api/you";
import { ProjectPicker, TaskPicker } from "../../src/forms/pickers";
import { FormSection, Sheet } from "../../src/forms/sheet";
import {
	ActionButton,
	EmptyState,
	ErrorBanner,
	ListRow,
	Skeleton,
	Text,
} from "../../src/ui/components";
import { messageOf } from "../../src/ui/errors";
import { Icon } from "../../src/ui/icon";
import { usePalette } from "../../src/ui/theme";

/** One filing rule: where its entries go, or remove it. */
export default function FilingRuleSheet() {
	const { id } = useLocalSearchParams<{ id?: string }>();
	const rules = useFilingRules();
	const rule = rules.data?.find((row) => row.id === id);

	if (rules.isPending) {
		return (
			<Sheet title="Filing rule" actionLabel="Save" onAction={() => {}} busy>
				<Skeleton height={56} radius={16} />
				<Skeleton height={56} radius={16} />
			</Sheet>
		);
	}
	if (!rule) {
		return (
			<Sheet
				title="Filing rule"
				actionLabel="Save"
				onAction={() => {}}
				actionDisabled
			>
				{rules.error ? (
					<ErrorBanner message={messageOf(rules.error) ?? ""} />
				) : (
					<EmptyState
						icon="inbox"
						title="This rule is gone"
						message="It was changed or removed somewhere else."
					/>
				)}
			</Sheet>
		);
	}
	return <RuleForm rule={rule} />;
}

function RuleForm({ rule }: { rule: FilingRule }) {
	const palette = usePalette();
	const router = useRouter();
	const update = useUpdateFilingRule();
	const remove = useDeleteFilingRule();
	const [projectId, setProjectId] = useState(rule.project.id);
	const [targetTaskId, setTargetTaskId] = useState(rule.targetTask?.id ?? null);
	const busy = update.isPending || remove.isPending;
	const failure = messageOf(update.error ?? remove.error);

	const save = () =>
		update.mutate(
			{ id: rule.id, patch: { projectId, targetTaskId } },
			{ onSuccess: () => router.back() },
		);

	const confirmRemove = () =>
		Alert.alert(
			"Remove this rule?",
			"Entries it filed stay where they are. New ones with this name wait for you in File your time again.",
			[
				{ text: "Cancel", style: "cancel" },
				{
					text: "Remove",
					style: "destructive",
					onPress: () =>
						remove.mutate(rule.id, { onSuccess: () => router.back() }),
				},
			],
		);

	return (
		<Sheet title="Filing rule" actionLabel="Save" onAction={save} busy={busy}>
			{failure ? <ErrorBanner message={failure} /> : null}
			<View style={{ gap: 4 }}>
				<Text variant="titleMedium">{rule.title}</Text>
				<Text variant="bodyMedium" color={palette.onSurfaceVariant}>
					Entries with this name arrive as {rule.task.name}.
				</Text>
			</View>
			<FormSection label="Project">
				<ProjectPicker
					value={projectId}
					allowNone={false}
					onChange={(next) => {
						if (next) setProjectId(next);
					}}
				/>
			</FormSection>
			<FormSection label="Task">
				<View
					style={{
						borderRadius: 16,
						overflow: "hidden",
						backgroundColor: palette.surfaceContainer,
					}}
				>
					<ListRow
						title={`Keep ${rule.task.name}`}
						subtitle="File it with the task it arrives with"
						selected={targetTaskId === null}
						onPress={() => setTargetTaskId(null)}
						trailing={
							targetTaskId === null ? (
								<Icon name="check" size={20} color={palette.primary} />
							) : undefined
						}
					/>
				</View>
				<TaskPicker
					value={targetTaskId}
					onChange={(task) => setTargetTaskId(task.id)}
				/>
			</FormSection>
			<View style={{ flexDirection: "row" }}>
				<ActionButton
					label="Remove rule"
					variant="text"
					onPress={confirmRemove}
					disabled={busy}
				/>
			</View>
		</Sheet>
	);
}
