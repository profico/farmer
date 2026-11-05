import { z } from "zod";

export const createClientInput = z.object({
	name: z.string().trim().min(1, "Name is required").max(120),
});
export type CreateClientInput = z.infer<typeof createClientInput>;

export const updateClientInput = z.object({
	clientId: z.uuid(),
	name: z.string().trim().min(1, "Name is required").max(120),
});
export type UpdateClientInput = z.infer<typeof updateClientInput>;

export const clientIdInput = z.uuid();
export type ClientIdInput = z.infer<typeof clientIdInput>;

// The query of `GET /api/v1/orgs/$slug/clients`. A query value is a string, so
// the flag is the word "true". Archived clients stay out unless it is sent.
export const listClientsInput = z.object({
	includeArchived: z.enum(["true", "false"]).optional(),
});
export type ListClientsInput = z.infer<typeof listClientsInput>;
