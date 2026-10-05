import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

import { type Csv, safeFileName, toCsv } from "./csv";

/**
 * Writes a CSV file to the cache of the app and opens the share sheet of
 * the system with it. The web downloads the same file; a phone has no
 * downloads folder that every app can see, so the person chooses where the
 * file goes. `name` has no extension.
 */
export const shareCsv = async (name: string, csv: Csv) => {
	if (!(await Sharing.isAvailableAsync())) {
		throw new Error("This device cannot share a file.");
	}
	const file = new File(Paths.cache, `${safeFileName(name)}.csv`);
	file.create({ overwrite: true });
	file.write(toCsv(csv));
	await Sharing.shareAsync(file.uri, {
		mimeType: "text/csv",
		UTI: "public.comma-separated-values-text",
		dialogTitle: "Export CSV",
	});
};
