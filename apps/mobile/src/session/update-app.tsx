import { ApiClientError } from "@farmer/api-client";
import { Linking } from "react-native";

import { STORE_URL } from "../config";
import { ActionButton } from "../ui/components";
import { showDialog } from "../ui/dialog";

/** True when the server refused this app for its version (`minMobileVersion`). */
export const needsAppUpdate = (error: Error) =>
	error instanceof ApiClientError && error.kind === "update_required";

export function UpdateAppButton() {
	return (
		<ActionButton
			label="Update the app"
			onPress={() =>
				// A build from outside a store has no handler for the store link.
				Linking.openURL(STORE_URL).catch(() =>
					showDialog(
						"Update Farmer",
						"Install the new version from the store.",
					),
				)
			}
		/>
	);
}
