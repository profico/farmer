import type { ProjectDetail } from "@farmer/api-client";
import { Alert } from "react-native";

import { useArchiveProject } from "../api/projects";
import { messageOf } from "../ui/errors";

/**
 * Gives `confirm`, which asks to archive or restore a project and does it
 * on a yes, and the state of the change. The settings screen and the
 * long-press menu of the list share this, so the question is the same.
 */
export function useConfirmProjectStatus() {
	const archive = useArchiveProject();
	const confirm = (project: Pick<ProjectDetail, "id" | "name" | "status">) => {
		const archived = project.status === "archived";
		Alert.alert(
			archived ? `Restore ${project.name}?` : `Archive ${project.name}?`,
			archived
				? "People assigned to it can log time on it again."
				: "Nobody can log more time on it until it is restored. Everything already logged stays where it is.",
			[
				{ text: "Cancel", style: "cancel" },
				{
					text: archived ? "Restore" : "Archive",
					style: archived ? "default" : "destructive",
					onPress: () =>
						archive.mutate(
							{ id: project.id, archive: !archived },
							{
								onError: (error) =>
									Alert.alert(
										"Could not change the project's status",
										messageOf(error) ?? "",
									),
							},
						),
				},
			],
		);
	};
	return { confirm, pending: archive.isPending };
}
