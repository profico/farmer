import { invitationMail, sendMail } from "../lib/email";
import { membersService } from "../services/members.service";
import { slackService } from "../services/slack.service";

/** One invitation that exists already, as the email and the Slack DM need it. */
export type InvitationToDeliver = {
	invitationId: string;
	email: string;
	role: string;
	organization: { id: string; name: string; slug: string };
	inviterName: string;
};

/**
 * Tell a person about an invitation that is already written: the email, and a
 * Slack DM when the address is somebody in the org's Slack workspace.
 *
 * Two callers: better-auth's `sendInvitationEmail` (the People page) and the
 * Harvest import, which writes its invitations inside its own transaction and
 * so cannot go through `auth.api.createInvitation`. One function, so the
 * person gets the same email and the People page the same delivery badge
 * whichever way they were invited.
 */
export const deliverInvitation = async (
	input: InvitationToDeliver,
): Promise<void> => {
	const url = new URL(
		`/accept-invite/${input.invitationId}`,
		process.env.BETTER_AUTH_URL,
	);
	url.searchParams.set("email", input.email);
	url.searchParams.set("org", input.organization.name);
	url.searchParams.set("orgSlug", input.organization.slug);
	url.searchParams.set("role", input.role);
	const link = url.toString();

	const organizationId = input.organization.id;
	const { invitationId } = input;

	// "sending" is written before this returns, so the members list the
	// dialog refetches already has a row to put a badge on.
	await membersService.recordInvitationEmail(
		organizationId,
		invitationId,
		"sending",
	);

	// The send itself is not awaited. better-auth awaits this hook before
	// `createInvitation` returns, and the invitation row already exists
	// by then — so a slow mail server held the admin's dialog open for as
	// long as it took, over an invitation that had already happened. The
	// outcome lands on `invitationEmail` instead, and the members page
	// shows it; a failed invitation can be cancelled and sent again.
	void sendMail(
		invitationMail({
			to: input.email,
			inviterName: input.inviterName,
			organizationName: input.organization.name,
			role: input.role,
			link,
		}),
	).then(
		() =>
			membersService.recordInvitationEmail(
				organizationId,
				invitationId,
				"sent",
			),
		(error) => {
			console.error("[auth] invitation email failed", {
				invitationId,
				error,
			});
			return membersService.recordInvitationEmail(
				organizationId,
				invitationId,
				"failed",
				error instanceof Error ? error.message : String(error),
			);
		},
	);

	// And on Slack, when the address is somebody in the org's workspace.
	// Not awaited, for the same reason as the email; `sendInvitation`
	// never throws. It records nothing on `invitationEmail`, since that
	// row is the email's delivery state and a DM is not a fallback for it.
	void slackService.sendInvitation(organizationId, {
		email: input.email,
		inviterName: input.inviterName,
		organizationName: input.organization.name,
		role: input.role,
		path: `${url.pathname}${url.search}`,
	});
};
