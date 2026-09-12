import {
	copyTimeEntriesInput,
	copyWeekEntriesInput,
	createAbsenceForUserInput,
	createTimeEntryInput,
	deleteTimeEntryInput,
	fileTimeEntriesInput,
	listAbsenceForUserInput,
	listTimeEntriesRangeInput,
	logAbsenceRangeInput,
	overrideAbsenceEntryInput,
	setTimeEntryOvertimeInput,
	setWeekCellInput,
	updateTimeEntryDescriptionInput,
	updateTimeEntryInput,
} from "@farmer/core/schema";
import { createServerFn } from "@tanstack/react-start";

import { orgMiddleware } from "./auth";

export const listTimeEntriesRange = createServerFn({ method: "GET" })
	.middleware([orgMiddleware])
	.validator(listTimeEntriesRangeInput)
	.handler(async ({ data, context }) => {
		const { timeEntriesService } = await import("@farmer/core/services");
		return timeEntriesService.listRange(context.ctx, data);
	});

export const createTimeEntry = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.validator(createTimeEntryInput)
	.handler(async ({ data, context }) => {
		const { timeEntriesService } = await import("@farmer/core/services");
		return timeEntriesService.create(context.ctx, data);
	});

export const updateTimeEntry = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.validator(updateTimeEntryInput)
	.handler(async ({ data, context }) => {
		const { timeEntriesService } = await import("@farmer/core/services");
		return timeEntriesService.update(context.ctx, data);
	});

export const updateTimeEntryDescription = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.validator(updateTimeEntryDescriptionInput)
	.handler(async ({ data, context }) => {
		const { timeEntriesService } = await import("@farmer/core/services");
		return timeEntriesService.updateDescription(context.ctx, data);
	});

// The unfiled worklist: entries with no project yet (synced meetings, fill
// blocks), and the mutation that attributes one. Both are caller-scoped —
// filing your own time is not something anyone else does for you.
export const listUnfiledEntries = createServerFn({ method: "GET" })
	.middleware([orgMiddleware])
	.validator(listTimeEntriesRangeInput)
	.handler(async ({ data, context }) => {
		const { listUnfiledForUser } = await import("@farmer/core/services");
		return listUnfiledForUser(context.ctx, data);
	});

export const fileTimeEntries = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.validator(fileTimeEntriesInput)
	.handler(async ({ data, context }) => {
		const { timeEntriesService } = await import("@farmer/core/services");
		return timeEntriesService.fileMany(context.ctx, data);
	});

export const copyTimeEntriesWeek = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.validator(copyWeekEntriesInput)
	.handler(async ({ data, context }) => {
		const { timeEntriesService } = await import("@farmer/core/services");
		return timeEntriesService.copyWeek(context.ctx, data);
	});

export const setTimeEntryOvertime = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.validator(setTimeEntryOvertimeInput)
	.handler(async ({ data, context }) => {
		const { timeEntriesService } = await import("@farmer/core/services");
		return timeEntriesService.setOvertime(context.ctx, data);
	});

export const deleteTimeEntry = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.validator(deleteTimeEntryInput)
	.handler(async ({ data: timeEntryId, context }) => {
		const { timeEntriesService } = await import("@farmer/core/services");
		return timeEntriesService.remove(context.ctx, timeEntryId);
	});

// Copy a whole day onto another day. With no timer to run, this is the main
// affordance for people whose days have a repeating shape.
// One cell of the week grid. Deliberately its own endpoint rather than a
// create-or-update dance on the client: the grid addresses cells by
// (project, task, date), and resolving that to an entry id is the server's job.
export const setWeekCell = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.validator(setWeekCellInput)
	.handler(async ({ data, context }) => {
		const { timeEntriesService } = await import("@farmer/core/services");
		return timeEntriesService.setWeekCell(context.ctx, data);
	});

export const copyTimeEntriesDay = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.validator(copyTimeEntriesInput)
	.handler(async ({ data, context }) => {
		const { timeEntriesService } = await import("@farmer/core/services");
		return timeEntriesService.copyDay(context.ctx, data);
	});

// Booking your own Vacation / Sick Leave as a SPAN — "I'm off the 4th to the
// 15th" — rather than one entry per day. Nothing about the expansion happens
// here: which days of the range get an entry, and how long each one is, needs
// the caller's own working-hours schedule and the org's holiday calendar, so
// the service owns it (see `timeEntriesService.logAbsenceRange`). Self only;
// booking for somebody else is `createAbsenceForUser` below, which is PM-gated.
export const logAbsenceRange = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.validator(logAbsenceRangeInput)
	.handler(async ({ data, context }) => {
		const { timeEntriesService } = await import("@farmer/core/services");
		return timeEntriesService.logAbsenceRange(context.ctx, data);
	});

// ── PM absence corrections (PRD 4.1) ────────────────────────────────────────
// A PM may fix the Vacation/Sick entries of people on their projects, and only
// those. Worked-time corrections deliberately do NOT live here.

export const overrideAbsenceEntry = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.validator(overrideAbsenceEntryInput)
	.handler(async ({ data, context }) => {
		const { timeEntriesService } = await import("@farmer/core/services");
		return timeEntriesService.overrideAbsence(context.ctx, data);
	});

export const listAbsenceForUser = createServerFn({ method: "GET" })
	.middleware([orgMiddleware])
	.validator(listAbsenceForUserInput)
	.handler(async ({ data, context }) => {
		const { timeEntriesService } = await import("@farmer/core/services");
		return timeEntriesService.listAbsenceForUser(context.ctx, data);
	});

export const createAbsenceForUser = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.validator(createAbsenceForUserInput)
	.handler(async ({ data, context }) => {
		const { timeEntriesService } = await import("@farmer/core/services");
		return timeEntriesService.createAbsenceForUser(context.ctx, data);
	});

export const removeAbsenceEntry = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.validator(deleteTimeEntryInput)
	.handler(async ({ data: timeEntryId, context }) => {
		const { timeEntriesService } = await import("@farmer/core/services");
		return timeEntriesService.removeAbsence(context.ctx, timeEntryId);
	});
