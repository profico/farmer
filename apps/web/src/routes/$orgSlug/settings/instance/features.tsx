import { createFileRoute } from "@tanstack/react-router";

import {
	InstanceSettingsForm,
	requirePlatformAdmin,
} from "#/components/instance-settings.tsx";
import { SettingsEyebrow } from "#/components/settings-nav.tsx";
import { Page, PageHeader } from "#/components/ui/page-header.tsx";
import { instanceSettingsQuery } from "#/queries/instance-settings.ts";

/**
 * The deployment-wide switches, web push and PostHog.
 *
 * A switch here turns a feature off for every workspace at once, which is the
 * difference from a workspace's own settings, and the reason the lede leads
 * with it.
 */
export const Route = createFileRoute("/$orgSlug/settings/instance/features")({
	beforeLoad: requirePlatformAdmin,
	loader: async ({ context }) => {
		await context.queryClient.ensureQueryData(instanceSettingsQuery());
	},
	component: FeatureSettingsPage,
});

function FeatureSettingsPage() {
	return (
		<Page>
			<PageHeader
				eyebrow={<SettingsEyebrow />}
				title="Features"
				lede="A feature switched off here is off for every workspace on this deployment."
			/>

			<InstanceSettingsForm section="features" />
		</Page>
	);
}
