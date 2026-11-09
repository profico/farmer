import { defaultRewindYear, isRewindOpen } from "@farmer/core/lib/rewind";
import { dayKeyInTz } from "@farmer/core/lib/time";
import { dayKeySchema } from "@farmer/core/schema";
import { useSuspenseQuery } from "@tanstack/react-query";
import {
	createFileRoute,
	type ErrorComponentProps,
	Link,
	useCanGoBack,
	useNavigate,
	useRouter,
} from "@tanstack/react-router";
import { useEffect } from "react";
import { z } from "zod";

import {
	PILL,
	pillStyle,
	RewindMessage,
	RewindStory,
} from "#/components/rewind/rewind-story.tsx";
import { THEMES } from "#/components/rewind/slides.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { browserEnv, reloadIfStaleChunk } from "#/lib/stale-chunk.ts";
import { myRewindQuery } from "#/queries/rewind.ts";

const searchSchema = z.object({
	// No year: the one the home page would offer, else last year's.
	year: z.number().int().min(2000).max(2100).optional().catch(undefined),
	// Development only — the server drops it in production. Reads the year as
	// of that day, so December's projection can be looked at in any month.
	asOf: dayKeySchema.optional().catch(undefined),
});

export const Route = createFileRoute("/$orgSlug/rewind")({
	validateSearch: searchSchema,
	loaderDeps: ({ search }) => ({ year: search.year, asOf: search.asOf }),
	loader: async ({ context, params, deps }) => {
		// Read once per navigation and kept in the loader data: Rewind is a
		// whole-year view, so a day that passes in an open tab does not matter.
		const today =
			deps.asOf ?? dayKeyInTz(new Date(), context.organization.timezone);
		const year = deps.year ?? defaultRewindYear(today);
		// Asked here as well as on the server, so a Rewind that has not opened
		// yet is a screen that says when it does rather than an error.
		const open = isRewindOpen(year, today);
		if (open) {
			await context.queryClient.ensureQueryData(
				myRewindQuery(params.orgSlug, { year, asOf: deps.asOf }),
			);
		}
		return { year, open, today };
	},
	pendingComponent: () => <RewindMessage title="Rewinding your year…" />,
	errorComponent: RewindError,
	component: RewindPage,
});

function RewindError({ error }: ErrorComponentProps) {
	// Same recovery as `RouteError`: a chunk that a deploy removed needs a reload.
	const failure = error instanceof Error ? error : undefined;
	useEffect(() => {
		reloadIfStaleChunk(failure, browserEnv());
	}, [failure]);
	return (
		<RewindMessage
			title="This Rewind did not load."
			line={failure?.message ?? String(error)}
		/>
	);
}

function useClose() {
	const orgSlug = useOrgSlug();
	const router = useRouter();
	const canGoBack = useCanGoBack();
	const navigate = useNavigate();
	return () => {
		if (canGoBack) router.history.back();
		else void navigate({ to: "/$orgSlug", params: { orgSlug } });
	};
}

function RewindPage() {
	const { year, open, today } = Route.useLoaderData();
	const { asOf } = Route.useSearch();
	const orgSlug = useOrgSlug();
	const close = useClose();

	if (!open) {
		const lastYear = Number(today.slice(0, 4)) - 1;
		return (
			<RewindMessage
				title={`Your ${year} Rewind opens on 1 December.`}
				line="Until then, keep logging. Every hour goes into it."
				actions={
					<>
						<Link
							to="/$orgSlug/rewind"
							params={{ orgSlug }}
							search={{ year: lastYear, asOf }}
							className={PILL}
							style={pillStyle(THEMES.violet, true)}
						>
							Rewind {lastYear}
						</Link>
						<button
							type="button"
							className={PILL}
							style={pillStyle(THEMES.violet, false)}
							onClick={close}
						>
							Close
						</button>
					</>
				}
			/>
		);
	}
	return <OpenRewind key={year} year={year} asOf={asOf} onClose={close} />;
}

function OpenRewind({
	year,
	asOf,
	onClose,
}: {
	year: number;
	asOf: string | undefined;
	onClose: () => void;
}) {
	const orgSlug = useOrgSlug();
	const { session } = Route.useRouteContext();
	const { data: rewind } = useSuspenseQuery(
		myRewindQuery(orgSlug, { year, asOf }),
	);
	return (
		<RewindStory
			rewind={rewind}
			firstName={session.user.name.split(" ")[0] ?? session.user.name}
			onClose={onClose}
			extraActions={(theme) =>
				rewind.previousYearWorkedSeconds != null && (
					<Link
						to="/$orgSlug/rewind"
						params={{ orgSlug }}
						search={{ year: year - 1, asOf }}
						replace
						className={PILL}
						style={pillStyle(theme, false)}
					>
						Rewind {year - 1}
					</Link>
				)
			}
		/>
	);
}
