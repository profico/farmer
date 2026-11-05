// The vendor's half of `packages/core/src/jobs/job-failures.ts`: a background
// job that caught a failure and went on reports it here as `$exception`.
//
// The error goes through `withoutQueryValues`, as in `posthog-api.ts`: a
// database error holds the values of its query. Only the job name and the
// organization ride along. A message body or a person's input never does.

import type { JobFailure } from "@farmer/core/jobs";
import { withoutQueryValues } from "@farmer/core/lib/loggable-error";

import { getPostHogClient } from "./posthog-server";

const ANONYMOUS = "background-job";

export const posthogJobFailureSink = ({
	job,
	error,
	organizationId,
	userId,
}: JobFailure): void => {
	getPostHogClient()?.captureException(
		withoutQueryValues(
			error instanceof Error ? error : new Error(String(error)),
		),
		userId ?? ANONYMOUS,
		{
			job,
			// Undefined when the failure belongs to no organization; JSON drops it.
			organization_id: organizationId,
			// `background-job` is a bucket, not somebody: it must not mint a person
			// (see `propertiesOf` in `posthog-api.ts`).
			...(userId ? {} : { $process_person_profile: false }),
		},
	);
};
