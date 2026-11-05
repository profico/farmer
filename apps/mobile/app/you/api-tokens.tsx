import type { PersonalToken } from "@farmer/api-client";
import { useRouter } from "expo-router";

import { useApiTokens, useRevokeApiToken } from "../../src/api/account";
import { EmptyState, ErrorBanner, ErrorState } from "../../src/ui/components";
import { showDialog } from "../../src/ui/dialog";
import { messageOf } from "../../src/ui/errors";
import { notifyError } from "../../src/ui/notify-error";
import { Inset } from "../../src/ui/screen";
import {
	SettingsLink,
	SettingsSection,
	SettingsValue,
} from "../../src/ui/settings-list";
import { formatInstant } from "../../src/workspace/format";
import { tokenSubtitle } from "../../src/you/account";
import { ListSkeleton, YouScreen } from "../../src/you/components/you-screen";

const TITLE = "API tokens";
const EXPLANATION =
	"For a script or a scheduled job that calls the Farmer API. A token acts as you, so it sees what you see. Tokens belong to your account, and the list is the same in every workspace.";

/**
 * The tokens of the account, as Preferences on the web lists them. The list
 * never has a token, only its last four characters. A new token is shown one
 * time, on the sheet that makes it.
 */
export default function ApiTokensScreen() {
	const router = useRouter();
	const tokens = useApiTokens();
	const revoke = useRevokeApiToken();
	const add = {
		icon: "add",
		label: "New API token",
		onPress: () => router.push("/you/api-token-new"),
	} as const;

	if (tokens.isPending) {
		return (
			<YouScreen title={TITLE}>
				<ListSkeleton rows={3} />
			</YouScreen>
		);
	}
	if (tokens.isError) {
		return (
			<YouScreen title={TITLE}>
				<ErrorState
					error={tokens.error}
					onRetry={() => void tokens.refetch()}
				/>
			</YouScreen>
		);
	}

	const confirmRevoke = (token: PersonalToken) =>
		showDialog(
			`Revoke ${token.name}?`,
			"The next request made with this token is refused. You cannot undo this: a script that uses it needs a new token.",
			[
				{ text: "Cancel", style: "cancel" },
				{
					text: "Revoke",
					style: "destructive",
					onPress: () =>
						revoke.mutate(token.id, {
							onError: (error) =>
								notifyError("Could not revoke that token", error),
						}),
				},
			],
		);

	return (
		<YouScreen
			title={TITLE}
			action={add}
			refreshing={tokens.isRefetching}
			onRefresh={() => void tokens.refetch()}
		>
			{revoke.error ? (
				<Inset>
					<ErrorBanner message={messageOf(revoke.error) ?? ""} />
				</Inset>
			) : null}
			{tokens.data.length === 0 ? (
				<EmptyState
					icon="key"
					title="You have no API tokens"
					message={EXPLANATION}
				/>
			) : (
				<SettingsSection footer={EXPLANATION}>
					{tokens.data.map((token) => (
						<SettingsValue
							key={token.id}
							icon="key"
							tint="gray"
							title={token.name}
							subtitle={tokenSubtitle(token, formatInstant)}
							subtitleLines={4}
							value={token.expired ? "Expired" : "Revoke"}
							onPress={() => confirmRevoke(token)}
							actions={[
								{
									label: "Revoke",
									icon: "delete",
									destructive: true,
									onPress: () => confirmRevoke(token),
								},
							]}
						/>
					))}
				</SettingsSection>
			)}
			<SettingsSection
				title="Related"
				footer="The terminals, browsers and phones that signed in to your account."
			>
				<SettingsLink
					icon="devices"
					tint="gray"
					title="Signed-in devices"
					onPress={() => router.push("/you/devices")}
				/>
			</SettingsSection>
		</YouScreen>
	);
}
