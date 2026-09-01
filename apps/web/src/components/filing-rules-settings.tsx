import { TrayIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "#/components/ui/button.tsx";
import {
	PageSection,
	SettingList,
	SettingRow,
} from "#/components/ui/page-header.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { filingRulesQuery } from "#/queries/filing-rules.ts";
import { queryKeys } from "#/queries/keys.ts";
import { deleteFilingRule } from "#/server/filing-rules.ts";

// The management half of "Always file these here" (see UnfiledEntriesBanner).
// A rule set from a dialog and then never visible again is a setting you cannot
// remember making and cannot undo, so the list has to live somewhere — and
// Preferences is where it belongs rather than Integrations, because a rule is a
// personal filing habit and applies whether or not a calendar is connected.
//
// `useQuery`, not `useSuspenseQuery`: this section is additive to a page that
// already renders, and nothing here is worth blocking first paint for. It
// renders nothing at all until there is a rule, so the common case — somebody
// who never ticked the box — sees no explanation of a feature they aren't using.
export function FilingRulesSettings() {
	const orgSlug = useOrgSlug();
	const queryClient = useQueryClient();
	const { data: rules } = useQuery(filingRulesQuery(orgSlug));

	const removeMutation = useMutation({
		mutationFn: (id: string) => deleteFilingRule({ data: { id } }),
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: [...queryKeys(orgSlug).filingRules],
			});
			toast.success("Rule removed");
		},
		onError: (error: Error) => toast.error(error.message),
	});

	if (!rules || rules.length === 0) return null;

	return (
		<PageSection
			title="Automatic filing"
			description="Meetings with these names are filed against their project as soon as they sync, instead of waiting for you in File your time. Removing a rule leaves entries it already filed alone."
		>
			<SettingList>
				{rules.map((rule) => (
					<SettingRow
						key={rule.id}
						icon={<TrayIcon className="size-5 text-muted-foreground" />}
						title={rule.title}
						description={`${rule.taskName} → ${rule.projectCode ? `[${rule.projectCode}] ` : ""}${rule.projectName}`}
						action={
							<Button
								variant="outline"
								size="sm"
								disabled={removeMutation.isPending}
								onClick={() => removeMutation.mutate(rule.id)}
							>
								Remove
							</Button>
						}
					/>
				))}
			</SettingList>
		</PageSection>
	);
}
