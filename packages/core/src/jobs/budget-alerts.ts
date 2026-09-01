import { and, eq, gt, inArray, sql } from "drizzle-orm";

import { db } from "../db";
import { member, organization } from "../db/schema/auth";
import { client, project, projectMember, timeEntry } from "../db/schema/domain";
import { projectBudgetAlert } from "../db/schema/notifications";
import { formatDuration } from "../lib/time";
import { notify } from "../services/notify";

export type BudgetAlertSummary = {
	projects: number;
	alerts: number;
	recipients: number;
};

// Budget burn alerts (PRD 6.6): a Fixed Scope project crossing 80% and then
// 100% of its HOUR budget tells the project's PMs and the org's admins. Hours
// only — a EUR budget is display-only context and there are no rates to compute
// with, so it is never alerted on.
//
// Idempotency lives in project_budget_alert, claimed per (project, threshold)
// BEFORE the send, so a crash mid-run costs at most one message rather than
// re-announcing every project on the next tick. Rows are cleared again when burn
// falls back under their threshold, which is what makes "the PM raised the
// budget" re-arm the alarm instead of silencing it for good.
const THRESHOLDS = [80, 100] as const;

export const runBudgetAlertsOnce = async (): Promise<BudgetAlertSummary> => {
	// Consumed hours per Fixed Scope project with an hour budget, across every
	// org in one pass — this job is org-agnostic and the set is small.
	const rows = await db
		.select({
			projectId: project.id,
			organizationId: project.organizationId,
			orgSlug: organization.slug,
			name: project.name,
			clientName: client.name,
			budgetSeconds: project.budgetSeconds,
			consumedSeconds: sql<string>`coalesce(sum(${timeEntry.durationSeconds}), 0)`,
		})
		.from(project)
		.innerJoin(client, eq(project.clientId, client.id))
		.innerJoin(organization, eq(project.organizationId, organization.id))
		.leftJoin(timeEntry, eq(timeEntry.projectId, project.id))
		.where(
			and(
				eq(project.status, "active"),
				eq(project.type, "fixed_scope"),
				sql`${project.budgetSeconds} is not null and ${project.budgetSeconds} > 0`,
			),
		)
		.groupBy(project.id, client.name, organization.slug);

	let alerts = 0;
	let recipients = 0;

	for (const row of rows) {
		const budgetSeconds = row.budgetSeconds ?? 0;
		if (budgetSeconds <= 0) continue;
		const consumedSeconds = Number(row.consumedSeconds);
		const burnPct = Math.round((consumedSeconds / budgetSeconds) * 100);

		// Re-arm: anything the project is no longer over stops counting as
		// announced. Done before the claim so a budget raise takes effect on the
		// same tick that notices it.
		await db
			.delete(projectBudgetAlert)
			.where(
				and(
					eq(projectBudgetAlert.projectId, row.projectId),
					gt(projectBudgetAlert.threshold, burnPct),
				),
			);

		// EVERY crossed threshold is claimed, not just the highest — then only the
		// highest NEWLY claimed one is announced.
		//
		// Claiming just the highest left holes: a project going 70% -> 100% in one
		// tick got a `100` row and no `80` row. The re-arm above deletes rows the
		// project is no longer over, so the first dip back under 100 removed the
		// only row it had, `crossed` resolved to 80, and the insert succeeded
		// against a threshold that had never been claimed. The project then
		// announced "has burned 95% of its hour budget" — a fresh alert for
		// spending LESS than it had already been alerted about.
		const crossed = THRESHOLDS.filter((t) => burnPct >= t);
		if (crossed.length === 0) continue;

		const claimed = await db
			.insert(projectBudgetAlert)
			.values(
				crossed.map((threshold) => ({
					organizationId: row.organizationId,
					projectId: row.projectId,
					threshold,
				})),
			)
			.onConflictDoNothing()
			.returning({ threshold: projectBudgetAlert.threshold });
		if (claimed.length === 0) continue;

		// One message per tick even when two thresholds were claimed at once: a
		// project that lands straight on 100% should say "over budget", not send an
		// 80% note alongside it.
		const announced = Math.max(...claimed.map((r) => r.threshold));

		alerts++;

		const audience = await alertAudience(row.organizationId, row.projectId);
		const remaining = budgetSeconds - consumedSeconds;
		const headline =
			announced >= 100
				? `${row.name} (${row.clientName}) is over its hour budget`
				: `${row.name} (${row.clientName}) has burned ${burnPct}% of its hour budget`;
		const detail =
			remaining >= 0
				? `${formatDuration(consumedSeconds)} of ${formatDuration(budgetSeconds)} — ${formatDuration(remaining)} left.`
				: `${formatDuration(consumedSeconds)} of ${formatDuration(budgetSeconds)} — ${formatDuration(-remaining)} over.`;

		for (const userId of audience) {
			recipients++;
			await notify(
				{ organizationId: row.organizationId, userId },
				{
					kind: "budget-alert",
					title: headline,
					body: detail,
					url: `/${row.orgSlug}/reports?tab=budget`,
				},
			);
		}
	}

	return { projects: rows.length, alerts, recipients };
};

/** The project's PMs plus the org's admins and owners, de-duplicated — the two
 *  groups overlap constantly and nobody wants the same alert twice. */
const alertAudience = async (
	organizationId: string,
	projectId: string,
): Promise<string[]> => {
	const [pms, admins] = await Promise.all([
		db
			.select({ userId: projectMember.userId })
			.from(projectMember)
			.where(
				and(
					eq(projectMember.organizationId, organizationId),
					eq(projectMember.projectId, projectId),
					eq(projectMember.role, "pm"),
					eq(projectMember.active, true),
				),
			),
		db
			.select({ userId: member.userId })
			.from(member)
			.where(
				and(
					eq(member.organizationId, organizationId),
					inArray(member.role, ["admin", "owner"]),
				),
			),
	]);
	return [...new Set([...pms, ...admins].map((r) => r.userId))];
};
