import { createFileRoute } from "@tanstack/react-router";

import {
	ConnectionCheck,
	InstanceSettingsForm,
	requirePlatformAdmin,
} from "#/components/instance-settings.tsx";
import { SettingsEyebrow } from "#/components/settings-nav.tsx";
import { Page, PageHeader } from "#/components/ui/page-header.tsx";
import { instanceSettingsQuery } from "#/queries/instance-settings.ts";
import { sendTestEmail } from "#/server/instance-settings.ts";

/**
 * How the deployment sends mail: invitations, reminders and sign-in links.
 *
 * The test sends to the signed-in person's own address and nowhere else. A
 * box for "send it to" would make this page a way for anybody holding the
 * role to mail anybody from the deployment's domain.
 */
export const Route = createFileRoute("/$orgSlug/settings/instance/email")({
	beforeLoad: requirePlatformAdmin,
	loader: async ({ context }) => {
		await context.queryClient.ensureQueryData(instanceSettingsQuery());
	},
	component: EmailSettingsPage,
});

function EmailSettingsPage() {
	const { session } = Route.useRouteContext();

	return (
		<Page>
			<PageHeader
				eyebrow={<SettingsEyebrow />}
				title="Email"
				lede="Invitations and reminders go out through Resend or an SMTP server. With neither, nothing is sent."
			/>

			<InstanceSettingsForm section="email" />

			<ConnectionCheck
				title="Test"
				description={`Sends one message to ${session.user.email} with the saved settings. Save your changes first.`}
				label="Send a test email"
				run={() => sendTestEmail()}
			/>
		</Page>
	);
}
