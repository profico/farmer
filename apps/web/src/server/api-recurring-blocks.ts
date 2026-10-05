import { type ApiRecurringBlock, toApiRecurringBlock } from "@farmer/core/api";
import type { Ctx } from "@farmer/core/services";

/**
 * One of the caller's recurring blocks, as the list shows it: with its task
 * and its project. A write answers through this, so the app can draw the row
 * without a second request. A rule of another person is not in the list, so
 * it is the same 404 as a rule that does not exist.
 */
export const ownRecurringBlock = async (
	ctx: Ctx,
	ruleId: string,
): Promise<ApiRecurringBlock> => {
	const { recurringBlockRulesService } = await import("@farmer/core/services");
	const rule = (await recurringBlockRulesService.list(ctx)).find(
		(row) => row.id === ruleId,
	);
	if (!rule) throw new Error("Recurring block not found");
	return toApiRecurringBlock(rule);
};
