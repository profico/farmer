import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { client } from "../db/schema/domain";
import type { Ctx } from "./types";

// Read-only for now: no mockup/flow exists for creating clients through the
// app yet, so the create-project dialog just picks from whatever already
// exists (with an empty state if there's nothing to pick from).
export const clientsService = {
	list: (ctx: Ctx) => {
		return db.query.client.findMany({
			where: and(
				eq(client.organizationId, ctx.organizationId),
				isNull(client.archivedAt),
			),
			orderBy: asc(client.name),
		});
	},
};
