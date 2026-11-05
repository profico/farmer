import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { View } from "react-native";

import { useAccess } from "../../../src/api/capabilities";
import { useProject } from "../../../src/api/projects";
import { projectPageAccess } from "../../../src/projects/access";
import { EntriesDrilldown } from "../../../src/reports/components/drilldown";
import { dayLabel } from "../../../src/reports/period";
import { ENTRY_GROUPS, type EntryGroupBy } from "../../../src/reports/views";
import { ActionButton, EmptyState, Text } from "../../../src/ui/components";
import { Inset, Screen } from "../../../src/ui/screen";
import { usePalette } from "../../../src/ui/theme";

type Params = {
	from?: string;
	to?: string;
	clientId?: string;
	projectId?: string;
	userId?: string;
	taskId?: string;
	activeOnly?: string;
	by?: string;
	title?: string;
};

const ALL_GROUPS = ENTRY_GROUPS.map((group) => group.value);

const asGroup = (value: string | undefined): EntryGroupBy =>
	ENTRY_GROUPS.find((group) => group.value === value)?.value ?? "date";

/** A link to the page of a project, for a person who may open it. */
function ProjectLink({ id }: { id: string }) {
	const router = useRouter();
	const access = useAccess();
	const { project } = useProject(id);
	if (!project) return null;
	const page = projectPageAccess(
		access.isAdmin,
		project.role,
		project.openToOrg,
	);
	if (!page.canView) return null;
	return (
		<ActionButton
			label="Open the project"
			variant="text"
			onPress={() =>
				router.push({ pathname: "/projects/[id]", params: { id } })
			}
		/>
	);
}

/**
 * The entries behind a figure of the Time report: the row that was opened
 * is the filter, and the entries are in groups. The web calls this the
 * Breakdown (`reports?view=breakdown`).
 */
export default function ReportDetailScreen() {
	const palette = usePalette();
	const params = useLocalSearchParams<Params>();
	const from = params.from ?? "";
	const to = params.to ?? "";
	const title = params.title ?? "Entries";

	if (!from || !to) {
		return (
			<Screen topInset={false}>
				<EmptyState
					icon="info"
					title="No period"
					message="Open the entries from a row of the Time report."
				/>
			</Screen>
		);
	}

	return (
		<>
			<Stack.Screen options={{ title }} />
			<Screen topInset={false}>
				<Inset>
					<View>
						<Text variant="titleLarge">{title}</Text>
						<Text variant="bodyMedium" color={palette.onSurfaceVariant}>
							{`${dayLabel(from)} - ${dayLabel(to)}${params.activeOnly === "1" ? ", active projects only" : ""}`}
						</Text>
					</View>
					{params.projectId ? <ProjectLink id={params.projectId} /> : null}
				</Inset>
				<EntriesDrilldown
					filters={{
						from,
						to,
						clientId: params.clientId,
						projectId: params.projectId,
						userId: params.userId,
						taskId: params.taskId,
						activeOnly: params.activeOnly === "1",
					}}
					groups={ALL_GROUPS}
					initialBy={asGroup(params.by)}
					exportName={`time-breakdown_${from}_${to}`}
				/>
			</Screen>
		</>
	);
}
