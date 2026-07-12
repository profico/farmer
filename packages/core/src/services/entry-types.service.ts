import { and, asc, count, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "../db";
import { project, timeEntry, timeEntryType } from "../db/schema/domain";
import type {
	CreateEntryTypeInput,
	UpdateEntryTypeInput,
} from "../schema/entry-types";
import type { Ctx } from "./types";

export const entryTypesService = {
	// Types selectable when logging a time entry: site defaults + this org's
	// own types + (if a project is given) that project's own types.
	listAvailable: (ctx: Ctx, opts?: { projectId?: string }) => {
		return db.query.timeEntryType.findMany({
			where: and(
				isNull(timeEntryType.archivedAt),
				or(
					eq(timeEntryType.scope, "site"),
					and(
						eq(timeEntryType.scope, "organization"),
						eq(timeEntryType.organizationId, ctx.organizationId),
					),
					opts?.projectId
						? and(
								eq(timeEntryType.scope, "project"),
								eq(timeEntryType.projectId, opts.projectId),
								eq(timeEntryType.organizationId, ctx.organizationId),
							)
						: undefined,
				),
			),
			orderBy: asc(timeEntryType.name),
		});
	},

	// Everything relevant to this org (incl. archived), for the admin UI.
	listManaged: async (ctx: Ctx) => {
		const orgProjects = await db.query.project.findMany({
			where: eq(project.organizationId, ctx.organizationId),
			columns: { id: true },
		});
		const projectIds = orgProjects.map((p) => p.id);

		const types = await db.query.timeEntryType.findMany({
			where: or(
				eq(timeEntryType.scope, "site"),
				eq(timeEntryType.organizationId, ctx.organizationId),
				projectIds.length > 0
					? inArray(timeEntryType.projectId, projectIds)
					: undefined,
			),
			with: { project: true },
			orderBy: [asc(timeEntryType.scope), asc(timeEntryType.name)],
		});

		// How many of this org's own time entries reference each type — scoped to
		// this org even for shared "site" types, so the count reflects this org's
		// usage rather than every org on the platform.
		const counts = await db
			.select({ typeId: timeEntry.typeId, count: count() })
			.from(timeEntry)
			.where(eq(timeEntry.organizationId, ctx.organizationId))
			.groupBy(timeEntry.typeId);
		const countByType = new Map(counts.map((c) => [c.typeId, c.count]));

		return types.map((t) => ({
			...t,
			blockCount: countByType.get(t.id) ?? 0,
		}));
	},

	create: async (ctx: Ctx, input: CreateEntryTypeInput) => {
		if (input.scope === "project") {
			if (!input.projectId) {
				throw new Error("Project is required for a project-scoped type");
			}
			const proj = await db.query.project.findFirst({
				where: and(
					eq(project.id, input.projectId),
					eq(project.organizationId, ctx.organizationId),
				),
			});
			if (!proj) throw new Error("Project not found");
		}

		const [created] = await db
			.insert(timeEntryType)
			.values({
				scope: input.scope,
				organizationId: ctx.organizationId,
				projectId: input.scope === "project" ? input.projectId : null,
				name: input.name,
				color: input.color,
				description: input.description,
				billableDefault: input.billableDefault,
			})
			.returning();
		if (!created) throw new Error("Failed to create entry type");
		return created;
	},

	update: async (ctx: Ctx, input: UpdateEntryTypeInput) => {
		const existing = await db.query.timeEntryType.findFirst({
			where: and(
				eq(timeEntryType.id, input.entryTypeId),
				eq(timeEntryType.organizationId, ctx.organizationId),
			),
		});
		if (!existing) {
			throw new Error("Entry type not found");
		}
		if (existing.scope === "site") {
			throw new Error("Site-wide entry types cannot be edited");
		}

		const patch: {
			name?: string;
			color?: string;
			description?: string;
			billableDefault?: boolean;
		} = {};
		if (input.name !== undefined) patch.name = input.name;
		if (input.color !== undefined) patch.color = input.color;
		if (input.description !== undefined) patch.description = input.description;
		if (input.billableDefault !== undefined) {
			patch.billableDefault = input.billableDefault;
		}

		const [updated] = await db
			.update(timeEntryType)
			.set(patch)
			.where(eq(timeEntryType.id, input.entryTypeId))
			.returning();
		return updated;
	},

	archive: async (ctx: Ctx, entryTypeId: string) => {
		const existing = await db.query.timeEntryType.findFirst({
			where: and(
				eq(timeEntryType.id, entryTypeId),
				eq(timeEntryType.organizationId, ctx.organizationId),
			),
		});
		if (!existing) {
			throw new Error("Entry type not found");
		}
		if (existing.scope === "site") {
			throw new Error("Site-wide entry types cannot be archived");
		}

		await db
			.update(timeEntryType)
			.set({ archivedAt: new Date() })
			.where(eq(timeEntryType.id, entryTypeId));
	},
};
