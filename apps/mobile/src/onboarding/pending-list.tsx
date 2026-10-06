import type { ImportClaim, MyInvitation } from "@farmer/api-client";
import { useState } from "react";
import { View } from "react-native";

import {
	useAcceptImportClaim,
	useAcceptInvitation,
	useDeclineImportClaim,
	useDeclineInvitation,
	useEnterWorkspace,
	useMyImportClaims,
	useMyInvitations,
} from "../api/onboarding";
import { ActionButton, Text } from "../ui/components";
import { SettingsSection } from "../ui/settings-list";
import { usePalette } from "../ui/theme";
import { SPACE } from "../ui/type";
import {
	confirmDestructive,
	CustomRow,
	notifyError,
} from "../workspace/components";

/** "member" becomes "Member": the role as a person reads it. */
const roleLabel = (role: string | null) => {
	const value = role ?? "member";
	return value.charAt(0).toUpperCase() + value.slice(1);
};

/** One workspace that waits for an answer: its name, a line, and the
 *  buttons under them. */
function PendingRow({
	title,
	subtitle,
	busy,
	declineLabel,
	acceptLabel,
	onDecline,
	onAccept,
}: {
	title: string;
	subtitle: string;
	busy: boolean;
	declineLabel: string;
	acceptLabel: string;
	onDecline: () => void;
	onAccept: () => void;
}) {
	const palette = usePalette();
	return (
		<CustomRow>
			<View style={{ flex: 1, gap: SPACE.s }}>
				<View>
					<Text variant="bodyLarge" numberOfLines={1}>
						{title}
					</Text>
					<Text variant="bodyMedium" color={palette.onSurfaceVariant}>
						{subtitle}
					</Text>
				</View>
				<View
					style={{
						flexDirection: "row",
						justifyContent: "flex-end",
						gap: SPACE.s,
					}}
				>
					<ActionButton
						label={declineLabel}
						variant="text"
						disabled={busy}
						onPress={onDecline}
					/>
					<ActionButton
						label={acceptLabel}
						disabled={busy}
						onPress={onAccept}
					/>
				</View>
			</View>
		</CustomRow>
	);
}

/**
 * The invitations to the person and the claims of a Harvest import, each
 * with its answer, as the web's page for a person without a workspace
 * shows them. A join opens the workspace at once; then `onEntered` runs.
 */
export function PendingList({ onEntered }: { onEntered?: () => void }) {
	const invitations = useMyInvitations();
	const claims = useMyImportClaims();
	const acceptInvitation = useAcceptInvitation();
	const declineInvitation = useDeclineInvitation();
	const acceptClaim = useAcceptImportClaim();
	const declineClaim = useDeclineImportClaim();
	const enter = useEnterWorkspace();
	// One answer at a time, as on the web: every button waits for it.
	const [busy, setBusy] = useState<{ id: string; action: string } | null>(null);

	const run = async (
		id: string,
		action: "accept" | "decline",
		/** The slug of the workspace to open, or null after a decline. */
		work: () => Promise<string | null>,
		failure: string,
	) => {
		setBusy({ id, action });
		try {
			const slug = await work();
			if (slug !== null) {
				await enter(slug);
				onEntered?.();
			}
		} catch (error) {
			notifyError(
				failure,
				error instanceof Error ? error : new Error(String(error)),
			);
		} finally {
			setBusy(null);
		}
	};

	const label = (id: string, action: string, idle: string, working: string) =>
		busy?.id === id && busy.action === action ? working : idle;

	const claimRow = (claim: ImportClaim) => (
		<PendingRow
			key={claim.organizationId}
			title={claim.name}
			subtitle={`${claim.name} imported your history from Harvest. Join to see it.`}
			busy={busy !== null}
			declineLabel={label(
				claim.organizationId,
				"decline",
				"Decline",
				"Declining",
			)}
			acceptLabel={label(claim.organizationId, "accept", "Join", "Joining")}
			onDecline={() =>
				confirmDestructive({
					title: `Decline ${claim.name}?`,
					message:
						"You leave the workspace. The history that it imported stays with it.",
					action: "Decline",
					onConfirm: () =>
						void run(
							claim.organizationId,
							"decline",
							async () => {
								await declineClaim.mutateAsync(claim.organizationId);
								return null;
							},
							"Could not answer the claim",
						),
				})
			}
			onAccept={() =>
				void run(
					claim.organizationId,
					"accept",
					async () =>
						(await acceptClaim.mutateAsync(claim.organizationId)).slug,
					"Could not answer the claim",
				)
			}
		/>
	);

	const invitationRow = (invitation: MyInvitation) => (
		<PendingRow
			key={invitation.id}
			title={invitation.organization.name}
			subtitle={roleLabel(invitation.role)}
			busy={busy !== null}
			declineLabel={label(invitation.id, "decline", "Decline", "Declining")}
			acceptLabel={label(invitation.id, "accept", "Accept", "Joining")}
			onDecline={() =>
				confirmDestructive({
					title: `Decline the invitation to ${invitation.organization.name}?`,
					message: "An admin of the workspace can invite you again.",
					action: "Decline",
					onConfirm: () =>
						void run(
							invitation.id,
							"decline",
							async () => {
								await declineInvitation.mutateAsync(invitation.id);
								return null;
							},
							"Could not decline the invitation",
						),
				})
			}
			onAccept={() =>
				void run(
					invitation.id,
					"accept",
					async () => (await acceptInvitation.mutateAsync(invitation.id)).slug,
					"Could not accept the invitation",
				)
			}
		/>
	);

	const claimList = claims.data ?? [];
	const invitationList = invitations.data ?? [];
	return (
		<>
			{claimList.length > 0 ? (
				<SettingsSection title="Harvest imports">
					{claimList.map(claimRow)}
				</SettingsSection>
			) : null}
			{invitationList.length > 0 ? (
				<SettingsSection
					title="Invitations"
					footer={
						invitationList.length === 1
							? "An invitation waits for you. Accept it to join the workspace."
							: "Invitations wait for you. Accept one to join its workspace."
					}
				>
					{invitationList.map(invitationRow)}
				</SettingsSection>
			) : null}
		</>
	);
}
