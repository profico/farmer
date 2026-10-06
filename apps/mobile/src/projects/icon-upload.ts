import { useServerFeatures } from "../api/capabilities";
import { useUploadImage } from "../api/uploads";
import { notifyError } from "../workspace/components";

/**
 * The `upload` of `ProjectFields`, or undefined when the Server stores no
 * images. A chosen image goes to the Server at once, and its path goes to
 * `onUploaded`, which puts it in the form. The project changes only on
 * Save, so a form that closes without Save leaves the project as it was.
 */
export const useIconUpload = (onUploaded: (path: string) => void) => {
	const { uploads } = useServerFeatures();
	const upload = useUploadImage("project-icon");
	if (!uploads) return undefined;
	return {
		busy: upload.isPending,
		onPress: () =>
			upload.mutate(undefined, {
				onSuccess: (path) => {
					if (path) onUploaded(path);
				},
				onError: (error) => notifyError("Could not upload the image", error),
			}),
	};
};
