import { z } from "zod";

// Every field optional so the update is a partial patch — the form/toggle
// sends only the switch that changed, and the service leaves the rest as-is.
export const updateIntegrationSettingsInput = z.object({
	googleAutoSyncMeetings: z.boolean().optional(),
	githubAutoLoadCommits: z.boolean().optional(),
	githubSyncCommitsAsWorkTime: z.boolean().optional(),
});
export type UpdateIntegrationSettingsInput = z.infer<
	typeof updateIntegrationSettingsInput
>;
