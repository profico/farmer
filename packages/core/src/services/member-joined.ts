// What runs when somebody becomes a member of an organization, whoever made
// the membership.
//
// Three paths reach it: accepting an invitation and an admin adding somebody
// (better-auth's two `organizationHooks` in `auth/index.ts`), and accepting a
// pending claim from a Harvest import (`importClaimsService.accept`). The
// steps are the same on each path, so they live in one function rather than in
// three copies that drift apart.
//
// Shared module rather than a service: the membership itself names the
// organization and the person. The `Ctx` it takes is only the actor of the
// audit row, because an admin who adds somebody is not the person who joins.

import { recordAudit } from "./audit";
import { emitEvent, memberWebhookPayload } from "./events";
import { slackService } from "./slack.service";
import type { Ctx } from "./types";

/**
 * Record `member.joined`, match the new member to Slack, then emit
 * `member.added`.
 *
 * The audit row (issue #112) is here so that each way in writes it once.
 * `recordedBy` is the Ctx of the request that made the membership: the person
 * on an invitation or a claim, the admin on a direct add. Its organization is
 * the organization of `newMember`. `name` is the label
 * of the row, because a later rename must not change what the log says.
 *
 * Slack: becoming a member is the moment to match somebody, and it was
 * previously nobody's job — without this a new hire got no reminder DMs until
 * an admin pressed "Re-match people". `linkMember` swallows its own errors, so
 * a Slack outage costs the match, not the membership.
 *
 * `member.added` (issue #67): the Ctx names the new member as both the
 * organization and the actor, because there is no third party here. Joining is
 * something a person does to themselves. `emitEvent` never throws, so a webhook
 * cannot cost somebody their membership either. `recordAudit` never throws for
 * the same reason.
 */
export const memberJoined = async (
	recordedBy: Ctx,
	newMember: {
		organizationId: string;
		userId: string;
		role: string;
	},
	name: string,
): Promise<void> => {
	await recordAudit(recordedBy, {
		kind: "member.joined",
		subjectUserId: newMember.userId,
		target: { type: "member", id: newMember.userId, label: name },
		details: { role: newMember.role },
	});
	await slackService.linkMember(newMember.organizationId, newMember.userId);
	const ctx = {
		organizationId: newMember.organizationId,
		userId: newMember.userId,
	};
	await emitEvent(ctx, "member.added", async () => {
		const payload = await memberWebhookPayload(ctx, newMember.userId);
		return payload ? { ...payload, role: newMember.role } : null;
	});
};
