import data from "../generated/releases.json";
import {
	type ReleaseNote,
	type WebChanges,
	releaseDataSchema,
} from "./release-notes.ts";

export type { ReleaseNote, WebChanges, WebCommit } from "./release-notes.ts";

// The build writes the file (`scripts/fetch-releases.ts`), and the repository
// holds an empty stub, so this parse also guards against a half-written file.
const parsed = releaseDataSchema.parse(data);

/** Newest first. Empty when the build could not reach GitHub. */
export const releases: ReleaseNote[] = parsed.releases;

export const webChanges: WebChanges = { commits: parsed.commits };
