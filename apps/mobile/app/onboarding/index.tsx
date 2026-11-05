import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";

import { useMyImportClaims, useMyInvitations } from "../../src/api/onboarding";
import { PendingList } from "../../src/onboarding/pending-list";
import { useSignedIn } from "../../src/session/session";
import { EmptyState, ErrorState } from "../../src/ui/components";
import { Screen } from "../../src/ui/screen";
import { ListSkeleton } from "../../src/workspace/components";

/**
 * The invitations and the Harvest claims that wait for the person, from
 * the Workspaces section of More. A join opens the new workspace and goes
 * back to the tabs.
 */
export default function InvitationsScreen() {
	const router = useRouter();
	const queryClient = useQueryClient();
	const { origin } = useSignedIn();
	const invitations = useMyInvitations();
	const claims = useMyImportClaims();

	const content = () => {
		if (invitations.isPending || claims.isPending) {
			return <ListSkeleton rows={2} />;
		}
		if (invitations.isError || claims.isError) {
			return (
				<ErrorState
					error={
						invitations.error ??
						claims.error ??
						new Error("The invitations did not load.")
					}
					onRetry={() => {
						void invitations.refetch();
						void claims.refetch();
					}}
				/>
			);
		}
		if (invitations.data.length + claims.data.length === 0) {
			return (
				<EmptyState
					icon="invitation"
					title="No invitations"
					message="No invitation or Harvest import waits for your answer."
				/>
			);
		}
		return <PendingList onEntered={() => router.dismissTo("/")} />;
	};

	return (
		<Screen
			topInset={false}
			refreshing={invitations.isRefetching || claims.isRefetching}
			onRefresh={() =>
				void queryClient.refetchQueries({
					queryKey: ["farmer", origin, "me"],
				})
			}
		>
			{content()}
		</Screen>
	);
}
