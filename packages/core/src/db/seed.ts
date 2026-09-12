import { eq } from "drizzle-orm";

import { db } from "./index";
import { member, organization } from "./schema/auth";
import {
	client,
	project,
	projectMember,
	projectTask,
	task,
} from "./schema/domain";
import { memberTypeHistory } from "./schema/people";
import { monthlyHourFund } from "./schema/settings";
import { ensureOrgTasks, ensureSiteTasks } from "./seed-tasks";

const targetSlug = process.argv[2];

const org = targetSlug
	? await db.query.organization.findFirst({
			where: eq(organization.slug, targetSlug),
		})
	: await db.query.organization.findFirst();

if (!org) {
	console.error(
		targetSlug
			? `No organization found with slug "${targetSlug}".`
			: "No organization found. Sign up in the app first, then re-run `bun run db:seed`.",
	);
	process.exit(1);
}

await ensureSiteTasks();
await ensureOrgTasks(org.id);

const orgTasks = await db.query.task.findMany({
	where: eq(task.organizationId, org.id),
	columns: { id: true, name: true },
});
const taskIdByName = new Map(orgTasks.map((t) => [t.name, t.id]));

// Every project belongs to a client, and internal work goes to the org's own
// client — which is why `project.clientId` can be NOT NULL.
const [internalClient] = await db
	.insert(client)
	.values({ organizationId: org.id, name: org.name, isInternal: true })
	.onConflictDoNothing()
	.returning();

const [seedClient] = await db
	.insert(client)
	.values({ organizationId: org.id, name: "Acme Inc." })
	.returning();
if (!seedClient) throw new Error("Failed to insert seed client");

// One project per type that behaves differently, so each type's behaviour is
// visible immediately after seeding.
const [productTeam] = await db
	.insert(project)
	.values({
		organizationId: org.id,
		clientId: seedClient.id,
		name: "Acme Product Team",
		code: "ACME",
		type: "product_team",
	})
	.returning();
if (!productTeam) throw new Error("Failed to insert seed project");

const [fixedScope] = await db
	.insert(project)
	.values({
		organizationId: org.id,
		clientId: seedClient.id,
		name: "Acme Website Redesign",
		code: "AWR",
		type: "fixed_scope",
		budgetSeconds: 400 * 3600,
		budgetAmount: "32000.00",
	})
	.returning();

const internal =
	internalClient ??
	(await db.query.client.findFirst({
		where: eq(client.organizationId, org.id),
		columns: { id: true, name: true, isInternal: true },
	}));

if (internal?.isInternal) {
	await db.insert(project).values({
		organizationId: org.id,
		clientId: internal.id,
		name: "Internal",
		type: "internal",
	});
}

// Projects cherry-pick their applicable subset of the global task list.
const pickFor = (projectId: string, names: string[]) =>
	names
		.map((name) => taskIdByName.get(name))
		.filter((id): id is string => !!id)
		.map((taskId) => ({ organizationId: org.id, projectId, taskId }));

const picks = [
	...pickFor(productTeam.id, [
		"Development",
		"Design",
		"Meeting",
		"Code review",
		"QA & testing",
		"Project management",
	]),
	...(fixedScope
		? pickFor(fixedScope.id, ["Development", "Design", "QA & testing"])
		: []),
];
if (picks.length > 0) {
	await db.insert(projectTask).values(picks).onConflictDoNothing();
}

// Assign every org member to the product-team project, with the first member as
// its PM so a project-managing role exists straight after seeding.
const members = await db.query.member.findMany({
	where: eq(member.organizationId, org.id),
	columns: { userId: true },
});
if (members.length > 0) {
	await db
		.insert(projectMember)
		.values(
			members.map((m, index) => ({
				organizationId: org.id,
				projectId: productTeam.id,
				userId: m.userId,
				role: index === 0 ? ("pm" as const) : ("member" as const),
			})),
		)
		.onConflictDoNothing();

	// Everyone starts Billable, effective-dated from the start of this year so
	// past-month reports resolve to something.
	const thisYear = new Date().getUTCFullYear();
	await db
		.insert(memberTypeHistory)
		.values(
			members.map((m) => ({
				organizationId: org.id,
				userId: m.userId,
				type: "employee_billable" as const,
				effectiveFrom: `${thisYear}-01-01`,
			})),
		)
		.onConflictDoNothing();
}

// A monthly hour fund for the current month, so Expected has something to
// compute from. In production these come from the official calendar (or are
// typed in by an admin); 160h is the common Croatian month.
const now = new Date();
await db
	.insert(monthlyHourFund)
	.values({
		organizationId: org.id,
		year: now.getUTCFullYear(),
		month: now.getUTCMonth() + 1,
		fundSeconds: 160 * 3600,
	})
	.onConflictDoNothing();

console.log(
	`Seeded clients, projects, task picks, assignments and an hour fund for "${org.name}" (${org.slug}).`,
);
process.exit(0);
