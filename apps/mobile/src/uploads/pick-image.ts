import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";

import {
	fitsUploadLimit,
	MAX_SIDE,
	mayHaveAlpha,
	resizeTarget,
	type UploadPurpose,
} from "./limits";

type Encoding = { format: SaveFormat; compress: number };

/** PNG first for an image that can be transparent, then JPEG at a lower
 *  quality each time, until the text is below the limit of the server. */
const encodings = (alpha: boolean): Encoding[] => [
	...(alpha ? [{ format: SaveFormat.PNG, compress: 1 }] : []),
	{ format: SaveFormat.JPEG, compress: 0.9 },
	{ format: SaveFormat.JPEG, compress: 0.7 },
	{ format: SaveFormat.JPEG, compress: 0.5 },
];

/**
 * Lets the person choose an image from the photo library, and gives its
 * bytes as base64 for `uploadImage`. Null when the person cancels.
 *
 * Each image goes through the image manipulator: the library of an iPhone
 * can give HEIC, which the server refuses, and the server keeps 1 MB at
 * most. The image becomes PNG or JPEG, no larger than `MAX_SIDE`. A
 * project icon is cropped to a square in the picker, as the web shows it.
 */
export const pickImageData = async (
	purpose: UploadPurpose,
): Promise<string | null> => {
	const result = await ImagePicker.launchImageLibraryAsync({
		mediaTypes: ["images"],
		allowsEditing: purpose === "project-icon",
		aspect: [1, 1],
		quality: 1,
	});
	if (result.canceled) return null;
	const asset = result.assets[0];
	if (!asset) return null;

	const context = ImageManipulator.manipulate(asset.uri);
	const size = resizeTarget(asset.width, asset.height, MAX_SIDE[purpose]);
	if (size) context.resize(size);
	const image = await context.renderAsync();
	try {
		for (const encoding of encodings(mayHaveAlpha(asset.mimeType))) {
			const saved = await image.saveAsync({ ...encoding, base64: true });
			if (saved.base64 && fitsUploadLimit(saved.base64)) return saved.base64;
		}
	} finally {
		image.release();
		context.release();
	}
	throw new Error("The image is larger than 1 MB.");
};
