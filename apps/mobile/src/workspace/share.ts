import * as Clipboard from "expo-clipboard";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Share } from "react-native";

/** Puts the text on the system clipboard. */
export const copyText = async (text: string) => {
	await Clipboard.setStringAsync(text);
};

/**
 * Writes the CSV to a file in the cache and opens the system share sheet
 * with it, so the person can save it or send it. Where the sheet cannot
 * take a file, the text goes to the share sheet of React Native.
 */
export const shareCsv = async (fileName: string, csv: string) => {
	if (!(await Sharing.isAvailableAsync())) {
		await Share.share({ message: csv, title: fileName });
		return;
	}
	const file = new File(Paths.cache, fileName);
	file.create({ overwrite: true });
	file.write(csv);
	await Sharing.shareAsync(file.uri, {
		mimeType: "text/csv",
		UTI: "public.comma-separated-values-text",
		dialogTitle: fileName,
	});
};
