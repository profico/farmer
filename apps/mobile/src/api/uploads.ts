import { useMutation } from "@tanstack/react-query";

import type { UploadPurpose } from "../uploads/limits";
import { pickImageData } from "../uploads/pick-image";
import { useWorkspace } from "./queries";

/**
 * Lets the person choose an image, and stores it on the Server. The answer
 * is the path to send as the project's `icon` or the organization's
 * `logo`, or null when the person cancels. The upload changes nothing by
 * itself: the server removes a file that nothing uses after a day. Needs
 * `uploads` from `useServerFeatures`.
 */
export const useUploadImage = (purpose: UploadPurpose) => {
	const w = useWorkspace();
	return useMutation({
		mutationFn: async () => {
			const data = await pickImageData(purpose);
			if (data === null) return null;
			const { url } = await w.client.uploadImage(w.slug, { purpose, data });
			return url;
		},
	});
};
