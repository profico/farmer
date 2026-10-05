import { Linking } from "react-native";

import { notifyError } from "../components";

/** What to say about the "also uninstall" half of a GitHub disconnect when
 *  it did not simply happen. The words are the web's. `null` means that the
 *  plain success notice is the whole story. */
export const uninstallNote = (outcome: string): string | null => {
	switch (outcome) {
		case "shared":
			return "The app was left installed on GitHub: another workspace is still connected to it.";
		case "not-configured":
			return "The app was left installed on GitHub: this deployment holds no GitHub App credentials.";
		case "failed":
			return "The app was left installed on GitHub - GitHub refused the request. Remove it from GitHub settings.";
		default:
			return null;
	}
};

/** Opens an install page in the system browser. The install ends on the web,
 *  so the person must be signed in to Farmer there. A failure shows the
 *  server's sentence. */
export const openInstall = async (
	title: string,
	getUrl: () => Promise<{ url: string }>,
) => {
	try {
		const { url } = await getUrl();
		await Linking.openURL(url);
	} catch (error) {
		notifyError(
			title,
			error instanceof Error ? error : new Error("Try again."),
		);
	}
};
