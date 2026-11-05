/** Whether this member is the one active owner left. A member who is not an
 *  active owner is never the last one, so an archived owner can still be
 *  restored or removed while another owner is active. */
export const isLastActiveOwner = (
	member: { userId: string },
	activeOwners: readonly { userId: string }[],
): boolean =>
	activeOwners.length <= 1 &&
	activeOwners.some((owner) => owner.userId === member.userId);
