import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { member } from "../db/schema/auth";
import type { Ctx } from "./types";

export const membersService = {
	getRole: async (ctx: Ctx): Promise<string | null> => {
		const row = await db.query.member.findFirst({
			where: and(
				eq(member.organizationId, ctx.organizationId),
				eq(member.userId, ctx.userId),
			),
		});
		return row?.role ?? null;
	},
};
