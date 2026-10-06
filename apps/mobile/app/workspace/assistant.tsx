import { Redirect } from "expo-router";

/** The assistant's settings are a part of the workspace integrations, as on
 *  the web. This route stays for a link that points here. */
export default function AssistantSettingsScreen() {
	return <Redirect href="/workspace/integrations" />;
}
