import { showDialog } from "./dialog";

/** The failure of a change, in the app's dialog (the Material 3 dialog of
 *  `dialog-host.android.tsx` on Android), with the server's own sentence.
 *  A 403 for an API token arrives here too. */
export const notifyError = (title: string, error: Error) =>
	showDialog(title, error.message || "Something went wrong. Try again.");
