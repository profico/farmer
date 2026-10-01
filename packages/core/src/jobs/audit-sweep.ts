// One tick of the audit log's retention: delete every row older than its
// organization keeps (the Audit log page, one year by default). The rule is
// `sweepAuditLog` in `services/audit.ts`; this is the scheduler's handle on it.

import { sweepAuditLog } from "../services/audit";

export type AuditSweepSummary = { deleted: number };

export const runAuditSweepOnce = async ({
	now = new Date(),
}: { now?: Date } = {}): Promise<AuditSweepSummary> => ({
	deleted: await sweepAuditLog({ now }),
});
