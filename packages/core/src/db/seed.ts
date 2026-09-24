import { and, eq } from "drizzle-orm";

import { db } from "./index";
import { member, organization } from "./schema/auth";
import { client, project, projectMember } from "./schema/domain";
import { memberTypeHistory } from "./schema/people";
import { monthlyHourFund } from "./schema/settings";
import { ensureOrgTasks, ensureSiteTasks } from "./seed-tasks";

// `bun run db:seed [org-slug] [--skip-without-org]`. The flag is for
// `bun run setup`, which runs this before anyone has signed up: no
// organization is then a note, not a failure.
const args = process.argv.slice(2);
const skipWithoutOrg = args.includes("--skip-without-org");
const targetSlug = args.find((arg) => !arg.startsWith("--"));

const org = targetSlug
	? await db.query.organization.findFirst({
			where: eq(organization.slug, targetSlug),
		})
	: await db.query.organization.findFirst();

if (!org && skipWithoutOrg) {
	console.log(
		"No organization yet, so no demo data. Sign up in the app (the first account makes the organization), then run `bun run setup` again.",
	);
	process.exit(0);
}

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

// Safe to run twice: the demo client is the marker, and an organization that
// has it already holds everything below.
const DEMO_CLIENT = "Acme Inc.";
const seeded = await db.query.client.findFirst({
	where: and(eq(client.organizationId, org.id), eq(client.name, DEMO_CLIENT)),
	columns: { id: true },
});
if (seeded) {
	console.log(`"${org.name}" (${org.slug}) already has the demo data.`);
	process.exit(0);
}

// Every project belongs to a client, and internal work goes to the org's own
// client — which is why `project.clientId` can be NOT NULL.
const [internalClient] = await db
	.insert(client)
	.values({ organizationId: org.id, name: org.name, isInternal: true })
	.onConflictDoNothing()
	.returning();

const [seedClient] = await db
	.insert(client)
	.values({ organizationId: org.id, name: DEMO_CLIENT })
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

await db.insert(project).values({
	organizationId: org.id,
	clientId: seedClient.id,
	name: "Acme Website Redesign",
	code: "AWR",
	type: "fixed_scope",
	budgetSeconds: 400 * 3600,
	budgetAmount: "32000.00",
});

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
	`Seeded clients, projects, assignments and an hour fund for "${org.name}" (${org.slug}).`,
);
process.exit(0);
