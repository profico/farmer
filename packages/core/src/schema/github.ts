import { z } from "zod";

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected yyyy-MM-dd");

export const linkProjectRepoInput = z.object({
	projectId: z.uuid(),
	githubRepoId: z.coerce.number().int(),
	// Which connected installation this repo came from — determines the token
	// used to read its commits later.
	installationId: z.coerce.number().int(),
});
export type LinkProjectRepoInput = z.infer<typeof linkProjectRepoInput>;

export const connectInstallationInput = z.object({
	installationId: z.coerce.number().int(),
});
export type ConnectInstallationInput = z.infer<typeof connectInstallationInput>;

export const disconnectInstallationInput = z.uuid();
export type DisconnectInstallationInput = z.infer<
	typeof disconnectInstallationInput
>;

export const unlinkProjectRepoInput = z.uuid();
export type UnlinkProjectRepoInput = z.infer<typeof unlinkProjectRepoInput>;

export const listProjectReposInput = z.uuid();
export type ListProjectReposInput = z.infer<typeof listProjectReposInput>;

export const listAttachedCommitsInput = z.uuid();
export type ListAttachedCommitsInput = z.infer<typeof listAttachedCommitsInput>;

export const detachCommitInput = z.uuid();
export type DetachCommitInput = z.infer<typeof detachCommitInput>;

export const suggestCommitsInput = z.object({
	projectId: z.uuid(),
	date: dateKey,
});
export type SuggestCommitsInput = z.infer<typeof suggestCommitsInput>;

export const attachCommitsInput = z.object({
	timeEntryId: z.uuid(),
	commits: z
		.array(
			z.object({
				projectGithubRepoId: z.uuid(),
				sha: z.string(),
			}),
		)
		.min(1),
});
export type AttachCommitsInput = z.infer<typeof attachCommitsInput>;
