import { and, asc, eq, isNull } from "drizzle-orm";

import { db } from "../db";
import { client, project } from "../db/schema/domain";
import type { CreateClientInput, UpdateClientInput } from "../schema/clients";
import { ctxAccess, requireAdmin } from "./context";
import { clientWebhookPayload, emitEvent } from "./events";
import type { Ctx } from "./types";

// The org's own client, holding every Internal project. Named for the company by
// default; the point is not the name but that `project.clientId` can be NOT NULL
// with no nullable-client special case, while internal work stays trivially
// filterable (hours on Internal projects never count as invoiced anywhere).
const INTERNAL_CLIENT_FALLBACK_NAME = "Internal";

type DbClient = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export const clientsService = {
	list: (ctx: Ctx) =>
		db.query.client.findMany({
			where: and(
				eq(client.organizationId, ctx.organizationId),
				isNull(client.archivedAt),
			),
			orderBy: [asc(client.isInternal), asc(client.name)],
		}),

	listAll: (ctx: Ctx) =>
		db.query.client.findMany({
			where: eq(client.organizationId, ctx.organizationId),
			orderBy: [asc(client.isInternal), asc(client.name)],
		}),

	/** Get (or lazily create) the org's internal client. Idempotent and safe to
	 *  call from any write path — `client_internal_uidx` makes "exactly one per
	 *  org" a database guarantee rather than a convention, so a race between two
	 *  concurrent callers resolves to the same row instead of two. */
	ensureInternal: async (
		ctx: Ctx,
		orgName?: string,
		tx: DbClient = db,
	): Promise<string> => {
		const existing = await tx.query.client.findFirst({
			where: and(
				eq(client.organizationId, ctx.organizationId),
				eq(client.isInternal, true),
			),
			columns: { id: true },
		});

		if (existing) return existing.id;

		const [created] = await tx
			.insert(client)
			.values({
				organizationId: ctx.organizationId,
				name: orgName?.trim() || INTERNAL_CLIENT_FALLBACK_NAME,
				isInternal: true,
			})
			.onConflictDoNothing()
			.returning({ id: client.id });

		if (created) return created.id;

		// Lost the race — re-read the winner's row.
		const winner = await tx.query.client.findFirst({
			where: and(
				eq(client.organizationId, ctx.organizationId),
				eq(client.isInternal, true),
			),
			columns: { id: true },
		});

		if (!winner) throw new Error("Failed to resolve the internal client");

		return winner.id;
	},

	create: async (ctx: Ctx, input: CreateClientInput) => {
		// Admins, PMs and Team Leads can create clients (PRD 3.3) — in practice
		// anyone holding PM or TL on at least one project.
		const access = await ctxAccess(ctx);
		access.assertCanCreateProjects();

		const [created] = await db
			.insert(client)
			.values({
				organizationId: ctx.organizationId,
				name: input.name.trim(),
			})
			.returning();

		if (!created) throw new Error("Failed to create client");
		await emitEvent(ctx, "client.created", () =>
			clientWebhookPayload(ctx, created.id),
		);

		return created;
	},

	update: async (ctx: Ctx, input: UpdateClientInput) => {
		await requireAdmin(ctx);

		const [updated] = await db
			.update(client)
			.set({ name: input.name.trim(), updatedAt: new Date() })
			.where(
				and(
					eq(client.id, input.clientId),
					eq(client.organizationId, ctx.organizationId),
				),
			)
			.returning();

		if (!updated) throw new Error("Client not found");

		return updated;
	},

	/** Archive, never hard delete — agencies churn clients and history must
	 *  survive. Blocked while active projects still hang off the client, since
	 *  `project.clientId` is restrict-on-delete and a project with an archived
	 *  client would be unreachable from the client filter. */
	archive: async (ctx: Ctx, clientId: string) => {
		await requireAdmin(ctx);

		const target = await db.query.client.findFirst({
			where: and(
				eq(client.id, clientId),
				eq(client.organizationId, ctx.organizationId),
			),
		});

		if (!target) throw new Error("Client not found");

		if (target.isInternal) {
			throw new Error("The internal client cannot be archived");
		}

		const activeProjects = await db.query.project.findFirst({
			where: and(
				eq(project.clientId, clientId),
				eq(project.organizationId, ctx.organizationId),
				eq(project.status, "active"),
			),
			columns: { id: true },
		});

		if (activeProjects) {
			throw new Error("Archive this client's active projects first");
		}

		await db
			.update(client)
			.set({ archivedAt: new Date(), updatedAt: new Date() })
			.where(eq(client.id, clientId));
	},

	unarchive: async (ctx: Ctx, clientId: string) => {
		await requireAdmin(ctx);
		await db
			.update(client)
			.set({ archivedAt: null, updatedAt: new Date() })
			.where(
				and(
					eq(client.id, clientId),
					eq(client.organizationId, ctx.organizationId),
				),
			);
	},
};
