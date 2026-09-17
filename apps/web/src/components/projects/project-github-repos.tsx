import { matchesSearch } from "@farmer/core/lib/search";
import {
	ArrowClockwiseIcon,
	LockIcon,
	PlugIcon,
	XIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { SearchInput } from "#/components/ui/search-input.tsx";
import {
	availableGithubReposQuery,
	githubConnectionStatusQuery,
	projectGithubReposQuery,
} from "#/queries/github.ts";
import {
	linkProjectGithubRepo,
	type listAvailableGithubRepos,
	type listProjectGithubRepos,
	refreshAvailableGithubRepos,
	unlinkProjectGithubRepo,
} from "#/server/github.ts";

type AvailableRepo = Awaited<
	ReturnType<typeof listAvailableGithubRepos>
>["repos"][number];

type LinkedRepo = Awaited<ReturnType<typeof listProjectGithubRepos>>[number];

/** A link the server has not answered yet — enough to draw its row. */
type PendingLink = Pick<
	AvailableRepo,
	"githubRepoId" | "installationId" | "fullName" | "private"
> & { projectId: string; projectName: string };

/** Above this many linkable repos, the list stays empty until a search. */
const SEARCH_FIRST_THRESHOLD = 10;

/** A list that scrolls inside its own border rather than growing the page. */
const LIST_CLASS =
	"scrollbar-stable max-h-80 overflow-y-auto overscroll-contain rounded-md border";

/** How old the repo list is: "just now", "12 min ago", "3 h ago", "2 d ago". */
const formatAge = (fetchedAt: Date, now: number) => {
	const minutes = Math.floor((now - fetchedAt.getTime()) / 60_000);

	if (minutes < 1) return "just now";

	if (minutes < 60) return `${minutes} min ago`;
	const hours = Math.floor(minutes / 60);

	if (hours < 24) return `${hours} h ago`;

	return `${Math.floor(hours / 24)} d ago`;
};

/**
 * Linking repositories to one project. The body only — no dialog, no panel — so
 * the same thing renders in the row-action dialog (the small-screen path, where
 * there is no detail panel) and in the panel's GitHub tab.
 *
 * A repo belongs to exactly ONE project org-wide, so the "link a repository"
 * list is not a list of everything the installation can see: a repo already
 * held elsewhere is shown as held, naming the project, rather than offered with
 * a button whose only outcome is `linkRepo`'s error. That is the whole reason
 * `listAvailableRepos` annotates each row with `linkedTo`.
 */
export function ProjectGithubRepos({
	projectId,
	projectName,
	orgSlug,
	enabled = true,
	className,
}: {
	projectId: string | null;
	/** Shown on the repo in other projects' lists until the next refetch. */
	projectName: string;
	orgSlug: string;
	/** Off while the surface holding this is closed, so a mounted-but-hidden copy
	 *  doesn't spend an installation's rate limit listing repos nobody asked for. */
	enabled?: boolean;
	className?: string;
}) {
	const queryClient = useQueryClient();
	const [search, setSearch] = useState("");

	// Search is per project: this is kept mounted across selections, so a query
	// typed for one project would still be filtering the next one's list.
	// oxlint-disable-next-line react-hooks/exhaustive-deps -- intentionally keyed on projectId — clears the filter when a different project is selected.
	useEffect(() => {
		setSearch("");
	}, [projectId]);

	const active = enabled && !!projectId;

	const { data: status } = useQuery({
		...githubConnectionStatusQuery(orgSlug),
		enabled: active,
	});

	const { data: linkedRepos } = useQuery({
		...projectGithubReposQuery(orgSlug, projectId ?? ""),
		enabled: active,
	});

	const { data: available } = useQuery({
		...availableGithubReposQuery(orgSlug),
		enabled: active && !!status?.connected,
	});

	const availableRepos = available?.repos;

	// Re-render once a minute, so "Updated 3 min ago" keeps counting.
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 60_000);

		return () => clearInterval(timer);
	}, []);

	// Links in flight, drawn in the linked list until the server answers. Kept
	// here rather than faked into the query cache because a linked row is a
	// database row, and a made-up id there is one an Unlink click would send.
	const [pendingLinks, setPendingLinks] = useState<PendingLink[]>([]);

	// Both writes are optimistic, and neither refetches the available list on
	// success. That list is a live call to GitHub per installation — it is what
	// made every click wait seconds — and after a write the cache already holds
	// the answer: the only field that moved is the repo's `linkedTo`, which is
	// set by hand below. A failure is the one case that refetches, since a
	// refused link usually means the list was stale about who holds the repo.
	const setHolder = (
		githubRepoId: number,
		linkedTo: AvailableRepo["linkedTo"],
	) =>
		queryClient.setQueryData(
			availableGithubReposQuery(orgSlug).queryKey,
			(list) =>
				list && {
					...list,
					repos: list.repos.map((r) =>
						r.githubRepoId === githubRepoId ? { ...r, linkedTo } : r,
					),
				},
		);

	const refetchAvailable = () =>
		queryClient.invalidateQueries({
			queryKey: availableGithubReposQuery(orgSlug).queryKey,
		});

	const linkMutation = useMutation({
		mutationFn: (link: PendingLink) =>
			linkProjectGithubRepo({
				data: {
					projectId: link.projectId,
					githubRepoId: link.githubRepoId,
					installationId: link.installationId,
				},
			}),
		onMutate: async (link) => {
			// A refetch already in flight would land without this change on top.
			await queryClient.cancelQueries({
				queryKey: availableGithubReposQuery(orgSlug).queryKey,
			});
			setPendingLinks((prev) => [...prev, link]);
			setHolder(link.githubRepoId, {
				projectId: link.projectId,
				projectName,
			});
		},
		onSuccess: (created, link) => {
			// Same tick as dropping the pending row, so React batches the two and
			// the repo is never drawn twice or not at all.
			setPendingLinks((prev) =>
				prev.filter((p) => p.githubRepoId !== link.githubRepoId),
			);
			queryClient.setQueryData(
				projectGithubReposQuery(orgSlug, link.projectId).queryKey,
				(rows) => rows && [created, ...rows.filter((r) => r.id !== created.id)],
			);
		},
		onError: (error, link) => {
			setPendingLinks((prev) =>
				prev.filter((p) => p.githubRepoId !== link.githubRepoId),
			);
			setHolder(link.githubRepoId, null);
			void refetchAvailable();
			toast.error(error.message ?? "Could not link repository");
		},
	});

	const unlinkMutation = useMutation({
		mutationFn: (repo: LinkedRepo) =>
			unlinkProjectGithubRepo({ data: repo.id }),
		onMutate: async (repo) => {
			const linkedKey = projectGithubReposQuery(
				orgSlug,
				repo.projectId,
			).queryKey;

			await Promise.all([
				queryClient.cancelQueries({ queryKey: linkedKey }),
				queryClient.cancelQueries({
					queryKey: availableGithubReposQuery(orgSlug).queryKey,
				}),
			]);
			queryClient.setQueryData(linkedKey, (rows) =>
				rows?.filter((r) => r.id !== repo.id),
			);
			setHolder(repo.githubRepoId, null);
		},
		onError: (error, repo) => {
			void Promise.all([
				queryClient.invalidateQueries({
					queryKey: projectGithubReposQuery(orgSlug, repo.projectId).queryKey,
				}),
				refetchAvailable(),
			]);
			toast.error(error.message ?? "Could not unlink repository");
		},
	});

	// Past the server's cache, for a repo created since the list was fetched.
	// The server read `linkedTo` before any link still in flight landed, so those
	// are laid back over its answer rather than offered as linkable again.
	const refreshMutation = useMutation({
		mutationFn: () => refreshAvailableGithubRepos(),
		onMutate: () =>
			queryClient.cancelQueries({
				queryKey: availableGithubReposQuery(orgSlug).queryKey,
			}),
		onSuccess: (fresh) => {
			queryClient.setQueryData(availableGithubReposQuery(orgSlug).queryKey, {
				...fresh,
				repos: fresh.repos.map((r) => {
					const pending = pendingLinks.find(
						(p) => p.githubRepoId === r.githubRepoId,
					);

					if (!pending) return r;

					return {
						...r,
						linkedTo: {
							projectId: pending.projectId,
							projectName: pending.projectName,
						},
					};
				}),
			});
		},
		onError: (error) =>
			toast.error(error.message ?? "Could not refresh repositories"),
	});

	const searching = search.trim() !== "";
	const matches = (fullName: string) => matchesSearch(search, [fullName]);

	const visibleLinkedRepos = (linkedRepos ?? []).filter((r) =>
		matches(r.fullName),
	);

	const visiblePendingLinks = pendingLinks.filter(
		(p) => p.projectId === projectId && matches(p.fullName),
	);

	// Everything this project doesn't already hold, held-elsewhere rows included
	// — they are the answer to "why can't I find it?", so hiding them turns a
	// stated rule back into a mystery.
	const linkableRepos = (availableRepos ?? []).filter(
		(r) => r.linkedTo?.projectId !== projectId && matches(r.fullName),
	);

	// An installation that reaches a whole organization lists hundreds of repos,
	// and nobody scrolls those for the one they know the name of — so past a
	// handful the list waits for a search instead of drawing all of them.
	const awaitingSearch =
		!searching && linkableRepos.length > SEARCH_FIRST_THRESHOLD;

	if (!projectId) {
		return (
			<p className="px-4 py-8 text-base text-muted-foreground">
				Select a project to link its repositories.
			</p>
		);
	}

	if (status && !status.connected) {
		return (
			<div className="flex flex-col items-center gap-3 py-6 text-center">
				<PlugIcon className="size-6 text-muted-foreground" />
				<p className="text-sm text-muted-foreground">
					Connect your GitHub account to link repositories to this project.
				</p>
				<Button
					variant="outline"
					nativeButton={false}
					render={
						<Link to="/$orgSlug/settings/integrations" params={{ orgSlug }}>
							Go to Integrations
						</Link>
					}
				/>
			</div>
		);
	}

	return (
		<div className={className}>
			<div className="grid min-w-0 gap-4">
				<SearchInput
					value={search}
					onValueChange={setSearch}
					placeholder="Search repositories…"
				/>

				<div className="min-w-0">
					<p className="eyebrow mb-2">Linked repositories</p>
					{visibleLinkedRepos.length + visiblePendingLinks.length > 0 ? (
						<div className={LIST_CLASS}>
							{visiblePendingLinks.map((repo) => (
								<div
									key={`pending-${repo.githubRepoId}`}
									className="flex items-center justify-between gap-2 border-b px-3 py-2 opacity-60 last:border-b-0"
								>
									<span className="flex min-w-0 items-center gap-1.5 text-sm">
										<span className="truncate">{repo.fullName}</span>
										{repo.private && (
											<Badge variant="outline" className="shrink-0 gap-1">
												<LockIcon className="size-3" />
												Private
											</Badge>
										)}
									</span>
									<span className="shrink-0 text-xs text-muted-foreground">
										Linking…
									</span>
								</div>
							))}
							{visibleLinkedRepos.map((repo) => (
								<div
									key={repo.id}
									className="flex items-center justify-between gap-2 border-b px-3 py-2 last:border-b-0"
								>
									<span className="flex min-w-0 items-center gap-1.5 text-sm">
										<span className="truncate">{repo.fullName}</span>
										{repo.private && (
											<Badge variant="outline" className="shrink-0 gap-1">
												<LockIcon className="size-3" />
												Private
											</Badge>
										)}
									</span>
									<Button
										variant="ghost"
										size="icon-xs"
										className="shrink-0 hover:text-destructive"
										onClick={() => unlinkMutation.mutate(repo)}
									>
										<XIcon weight="regular" className="size-3" />
										<span className="sr-only">Unlink</span>
									</Button>
								</div>
							))}
						</div>
					) : (
						<p className="text-sm text-muted-foreground">
							{searching
								? "No linked repositories match your search."
								: "No repositories linked yet."}
						</p>
					)}
				</div>

				<div className="min-w-0">
					<div className="mb-2 flex items-center justify-between gap-2">
						<p className="eyebrow">Link a repository</p>
						{available && (
							<span className="flex items-center gap-1 text-xs text-muted-foreground">
								{available.fetchedAt &&
									`Updated ${formatAge(available.fetchedAt, now)}`}
								<Button
									variant="ghost"
									size="icon-xs"
									disabled={refreshMutation.isPending}
									onClick={() => refreshMutation.mutate()}
								>
									<ArrowClockwiseIcon
										weight="regular"
										className={
											refreshMutation.isPending ? "animate-spin" : undefined
										}
									/>
									<span className="sr-only">Refresh repositories</span>
								</Button>
							</span>
						)}
					</div>
					{awaitingSearch ? (
						<p className="text-sm text-muted-foreground">
							Search to find one of {linkableRepos.length} repositories.
						</p>
					) : linkableRepos.length > 0 ? (
						<div className={LIST_CLASS}>
							{linkableRepos.map((repo) => (
								<div
									key={repo.githubRepoId}
									className="flex items-center justify-between gap-2 border-b px-3 py-2 last:border-b-0"
								>
									<span className="flex min-w-0 items-center gap-1.5 text-sm">
										<span className="truncate">{repo.fullName}</span>
										{repo.private && (
											<Badge variant="outline" className="shrink-0 gap-1">
												<LockIcon className="size-3" />
												Private
											</Badge>
										)}
									</span>
									{repo.linkedTo ? (
										// Held by another project. Says which one — "already
										// linked" leaves you opening every project to find it.
										<span className="shrink-0 truncate text-xs text-muted-foreground">
											On {repo.linkedTo.projectName ?? "another project"}
										</span>
									) : (
										<Button
											variant="outline"
											size="sm"
											className="shrink-0"
											onClick={() =>
												linkMutation.mutate({
													projectId,
													projectName,
													githubRepoId: repo.githubRepoId,
													installationId: repo.installationId,
													fullName: repo.fullName,
													private: repo.private,
												})
											}
										>
											Link
										</Button>
									)}
								</div>
							))}
						</div>
					) : (
						<p className="text-sm text-muted-foreground">
							{!availableRepos
								? "Loading repositories…"
								: searching
									? "No repositories match your search."
									: "No more repositories to link."}
						</p>
					)}
				</div>
			</div>
		</div>
	);
}
