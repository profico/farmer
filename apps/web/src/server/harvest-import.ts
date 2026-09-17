import {
	harvestEmailsInput,
	harvestFinishInput,
	harvestImportDaysInput,
	harvestRemoveDaysInput,
	harvestRunIdInput,
	harvestSnapshotInput,
	harvestStartInput,
} from "@farmer/core/schema";
import { createServerFn } from "@tanstack/react-start";

import { orgAdminMiddleware } from "./auth";

// The Harvest import (Settings → Import). The browser parses the export and
// builds the plan; these only carry it to `harvestImportService`, which
// checks every id against the org itself. Admin-only on both sides.

export const getHarvestSnapshot = createServerFn({ method: "POST" })
	.middleware([orgAdminMiddleware])
	.validator(harvestSnapshotInput)
	.handler(async ({ data, context }) => {
		const { harvestImportService } = await import("@farmer/core/services");

		return harvestImportService.snapshot(context.ctx, data);
	});

export const checkHarvestEmails = createServerFn({ method: "POST" })
	.middleware([orgAdminMiddleware])
	.validator(harvestEmailsInput)
	.handler(async ({ data, context }) => {
		const { harvestImportService } = await import("@farmer/core/services");

		return harvestImportService.takenEmails(context.ctx, data);
	});

export const listHarvestRuns = createServerFn({ method: "GET" })
	.middleware([orgAdminMiddleware])
	.handler(async ({ context }) => {
		const { harvestImportService } = await import("@farmer/core/services");

		return harvestImportService.listRuns(context.ctx);
	});

export const startHarvestImport = createServerFn({ method: "POST" })
	.middleware([orgAdminMiddleware])
	.validator(harvestStartInput)
	.handler(async ({ data, context }) => {
		const { harvestImportService } = await import("@farmer/core/services");

		return harvestImportService.start(context.ctx, data);
	});

export const importHarvestDays = createServerFn({ method: "POST" })
	.middleware([orgAdminMiddleware])
	.validator(harvestImportDaysInput)
	.handler(async ({ data, context }) => {
		const { harvestImportService } = await import("@farmer/core/services");

		return harvestImportService.importDays(context.ctx, data);
	});

export const removeHarvestDays = createServerFn({ method: "POST" })
	.middleware([orgAdminMiddleware])
	.validator(harvestRemoveDaysInput)
	.handler(async ({ data, context }) => {
		const { harvestImportService } = await import("@farmer/core/services");

		return harvestImportService.removeDays(context.ctx, data);
	});

export const finishHarvestImport = createServerFn({ method: "POST" })
	.middleware([orgAdminMiddleware])
	.validator(harvestFinishInput)
	.handler(async ({ data, context }) => {
		const { harvestImportService } = await import("@farmer/core/services");
		const result = await harvestImportService.finish(context.ctx, data);
		const { getPostHogClient } = await import("../lib/posthog-server");
		const posthog = getPostHogClient();

		if (posthog) {
			posthog.capture({
				distinctId: context.ctx.userId,
				event: "harvest_import_completed",
				properties: {
					organization_id: context.ctx.organizationId,
					import_run_id: data.runId,
				},
			});
			await posthog.flush();
		}

		return result;
	});

export const undoHarvestImport = createServerFn({ method: "POST" })
	.middleware([orgAdminMiddleware])
	.validator(harvestRunIdInput)
	.handler(async ({ data, context }) => {
		const { harvestImportService } = await import("@farmer/core/services");

		return harvestImportService.undo(context.ctx, data);
	});
