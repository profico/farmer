// What runs when somebody becomes a member of an organization, whoever made
// the membership.
//
// Three paths reach it: accepting an invitation and an admin adding somebody
// (better-auth's two `organizationHooks` in `auth/index.ts`), and accepting a
// pending claim from a Harvest import (`importClaimsService.accept`). The two
// steps are the same on each path, so they live in one function rather than in
// three copies that drift apart.
//
// Shared module rather than a service: it takes no `Ctx`, because on every one
// of those paths the person is acting on their own membership, and the
// organization and the user are the membership itself.

import { emitEvent, memberWebhookPayload } from "./events";
import { slackService } from "./slack.service";

/**
 * Match the new member to Slack, then emit `member.added`.
 *
 * Slack: becoming a member is the moment to match somebody, and it was
 * previously nobody's job — without this a new hire got no reminder DMs until
 * an admin pressed "Re-match people". `linkMember` swallows its own errors, so
 * a Slack outage costs the match, not the membership.
 *
 * `member.added` (issue #67): the Ctx names the new member as both the
 * organization and the actor, because there is no third party here. Joining is
 * something a person does to themselves. `emitEvent` never throws, so a webhook
 * cannot cost somebody their membership either.
 */
export const memberJoined = async (newMember: {
	organizationId: string;
	userId: string;
	role: string;
}): Promise<void> => {
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
