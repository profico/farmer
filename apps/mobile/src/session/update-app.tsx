import { ApiClientError } from "@farmer/api-client";
import { Linking } from "react-native";

import { STORE_URL } from "../config";
import { ActionButton } from "../ui/components";

/** True when the server refused this app for its version (`minMobileVersion`). */
export const needsAppUpdate = (error: Error) =>
	error instanceof ApiClientError && error.kind === "update_required";

export function UpdateAppButton() {
	return (
		<ActionButton
			label="Update the app"
			onPress={() => void Linking.openURL(STORE_URL)}
		/>
	);
}
