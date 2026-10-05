import { useRouter } from "expo-router";
import { useState } from "react";

import { useInvite } from "../../../src/api/workspace";
import { FormSection, Sheet } from "../../../src/forms/sheet";
import { ErrorBanner, Field } from "../../../src/ui/components";
import { messageOf } from "../../../src/ui/errors";
import { ChoiceSection, notify } from "../../../src/workspace/components";
import { ROLE_OPTIONS } from "../../../src/workspace/people/labels";

/** Invites a person by email, with the role they get when they join. */
export default function InviteSheet() {
	const router = useRouter();
	const invite = useInvite();
	const [email, setEmail] = useState("");
	const [role, setRole] = useState<"member" | "admin">("member");
	const address = email.trim();

	const send = () => {
		invite.mutate(
			{ email: address, role },
			{
				onSuccess: () => {
					notify("Invitation sent");
					router.back();
				},
			},
		);
	};

	return (
		<Sheet
			title="Invite a person"
			actionLabel="Send"
			onAction={send}
			busy={invite.isPending}
			actionDisabled={address === ""}
		>
			<Field
				label="Email"
				value={email}
				onChangeText={setEmail}
				keyboardType="email-address"
				autoCapitalize="none"
				autoCorrect={false}
				autoComplete="email"
				returnKeyType="send"
				onSubmitEditing={() => {
					if (address !== "" && !invite.isPending) send();
				}}
			/>
			<FormSection label="Role">
				<ChoiceSection options={ROLE_OPTIONS} value={role} onChange={setRole} />
			</FormSection>
			{invite.error ? (
				<ErrorBanner message={messageOf(invite.error) ?? ""} />
			) : null}
		</Sheet>
	);
}
