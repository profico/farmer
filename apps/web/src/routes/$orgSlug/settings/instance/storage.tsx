import { createFileRoute } from "@tanstack/react-router";

import {
	ConnectionCheck,
	InstanceSettingsForm,
	requirePlatformAdmin,
	type SaveConfirmation,
} from "#/components/instance-settings.tsx";
import { SettingsEyebrow } from "#/components/settings-nav.tsx";
import { Page, PageHeader } from "#/components/ui/page-header.tsx";
import { instanceSettingsQuery } from "#/queries/instance-settings.ts";
import { testStorageConnection } from "#/server/instance-settings.ts";

/**
 * The S3-compatible store behind uploads: project icons, logos, avatars.
 *
 * **A new endpoint or bucket is a move, and the page asks first.** Every
 * stored upload is a key into the CURRENT store, so pointing Farmer at another
 * one leaves every existing file behind: the rows still name them, and the new
 * store does not have them. Nothing copies them for you. The service refuses
 * such a save while anything is stored (`guardStorageMove`) and says how much;
 * the page then asks, and sends the save again with `confirmStorageMove`.
 */
export const Route = createFileRoute("/$orgSlug/settings/instance/storage")({
	beforeLoad: requirePlatformAdmin,
	loader: async ({ context }) => {
		await context.queryClient.ensureQueryData(instanceSettingsQuery());
	},
	component: StorageSettingsPage,
});

const confirmStoreMove = (storedObjects: number): SaveConfirmation => {
	const files = storedObjects === 1 ? "1 file" : `${storedObjects} files`;
	return {
		title: "Move to another store?",
		description: `The ${files} already uploaded stay in the old store. Icons, logos and photos that use them will not show until you copy them into the new one.`,
		action: "Save and move",
	};
};

function StorageSettingsPage() {
	return (
		<Page>
			<PageHeader
				eyebrow={<SettingsEyebrow />}
				title="Storage"
				lede="Uploads go to an S3-compatible store. Without one, people can still pick an emoji or paste an image URL, but they cannot upload a file."
			/>

			<InstanceSettingsForm
				section="storage"
				confirmStoreMove={confirmStoreMove}
			/>

			<ConnectionCheck
				title="Test"
				description="Writes, reads and deletes one small object with the saved settings. Save your changes first."
				label="Test connection"
				run={() => testStorageConnection()}
			/>
		</Page>
	);
}
