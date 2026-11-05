import { Redirect } from "expo-router";

/** Display is a part of Preferences, as on the web. This route stays for a
 *  link that points here. */
export default function DisplayScreen() {
	return <Redirect href="/you/preferences" />;
}
