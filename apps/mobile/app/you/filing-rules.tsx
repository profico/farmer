import { useRouter } from "expo-router";

import { useFilingRules } from "../../src/api/you";
import { EmptyState, ErrorState } from "../../src/ui/components";
import { SettingsLink, SettingsSection } from "../../src/ui/settings-list";
import { ListSkeleton, YouScreen } from "../../src/you/components/you-screen";

/**
 * The filing rules: a meeting or a block with one of these names is filed
 * against a project and a task, instead of waiting in File your time. A
 * press opens the rule, to change where it files or to remove it. The name
 * does not change: it is what the sync matches, so a new name is a new
 * rule.
 */
export default function FilingRulesScreen() {
	const router = useRouter();
	const rules = useFilingRules();

	return (
		<YouScreen
			title="Filing rules"
			refreshing={rules.isRefetching}
			onRefresh={() => void rules.refetch()}
		>
			{rules.isPending ? (
				<ListSkeleton rows={3} />
			) : rules.isError ? (
				<ErrorState error={rules.error} onRetry={() => void rules.refetch()} />
			) : rules.data.length === 0 ? (
				<EmptyState
					icon="inbox"
					title="No filing rules"
					message="When you file a meeting on the web, you can choose to always file it there. That makes a rule."
				/>
			) : (
				<SettingsSection footer="Meetings are filed as soon as they sync, and blocks as Assemble my day proposes them. A change to a rule does not move the entries it filed before.">
					{rules.data.map((rule) => (
						<SettingsLink
							key={rule.id}
							title={rule.title}
							subtitle={`${rule.project.name}, ${
								rule.targetTask?.name ?? rule.task.name
							}`}
							onPress={() =>
								router.push({
									pathname: "/you/filing-rule",
									params: { id: rule.id },
								})
							}
						/>
					))}
				</SettingsSection>
			)}
		</YouScreen>
	);
}
