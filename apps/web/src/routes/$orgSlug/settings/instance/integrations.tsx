import { createFileRoute } from "@tanstack/react-router";

import {
	InstanceSettingsForm,
	requirePlatformAdmin,
} from "#/components/instance-settings.tsx";
import { SettingsEyebrow } from "#/components/settings-nav.tsx";
import { Page, PageHeader } from "#/components/ui/page-header.tsx";
import { instanceSettingsQuery } from "#/queries/instance-settings.ts";

/**
 * The GitHub App and the Slack app the whole deployment connects through.
 *
 * Not Settings → Integrations (a person's own connections) and not Workspace
 * integrations (one organization's): this is the app registration every
 * workspace's connection is made with, which is why it sits under
 * Infrastructure and why the page says so in its lede.
 */
export const Route = createFileRoute(
	"/$orgSlug/settings/instance/integrations",
)({
	beforeLoad: requirePlatformAdmin,
	loader: async ({ context }) => {
		await context.queryClient.ensureQueryData(instanceSettingsQuery());
	},
	component: IntegrationSettingsPage,
});

function IntegrationSettingsPage() {
	return (
		<Page>
			<PageHeader
				eyebrow={<SettingsEyebrow />}
				title="Integration apps"
				lede="The GitHub App and the Slack app that every workspace on this deployment connects through. Each workspace still connects its own account."
			/>

			<InstanceSettingsForm section="integrations" />
		</Page>
	);
}
