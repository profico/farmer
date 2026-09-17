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
