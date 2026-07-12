import { eq } from "drizzle-orm";
import { db } from "./index";
import { organization } from "./schema/auth";
import { client, project, task } from "./schema/domain";

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

const [seedClient] = await db
	.insert(client)
	.values({ organizationId: org.id, name: "Acme Inc." })
	.returning();
if (!seedClient) throw new Error("Failed to insert seed client");

const [seedProject] = await db
	.insert(project)
	.values({
		organizationId: org.id,
		clientId: seedClient.id,
		name: "Website Redesign",
		code: "WEB",
	})
	.returning();
if (!seedProject) throw new Error("Failed to insert seed project");

await db.insert(task).values([
	{ organizationId: org.id, projectId: seedProject.id, name: "Design mockups" },
	{
		organizationId: org.id,
		projectId: seedProject.id,
		name: "Frontend implementation",
	},
	{ organizationId: org.id, projectId: seedProject.id, name: "QA & bug fixes" },
]);

console.log(`Seeded client/project/tasks for organization "${org.name}" (${org.slug}).`);
process.exit(0);
