import type { DirectoryEntry } from "@farmer/core/services";
import { useQuery } from "@tanstack/react-query";
import type * as React from "react";

import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "#/components/ui/avatar.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { cn, getInitials } from "#/lib/utils.ts";
import { directoryQuery } from "#/queries/members.ts";

// Module scope, not an inline arrow: TanStack re-runs `select` whenever the
// function's identity changes, and there is one observer per avatar on screen.
const imageByUserId = (rows: DirectoryEntry[]) =>
	new Map(rows.map((row) => [row.userId, row.image]));

/**
 * A person's face, resolved from the org directory by `userId`.
 *
 * Every row that lists people already carries a `userId` and most carry no
 * photo, so the lookup lives here rather than in nine row types — one shared
 * query, deduped across every avatar on the screen and warmed by the
 * `/$orgSlug` layout (see `queries/members.ts`).
 *
 * Falls back to initials, which is not only the loading state: a password
 * account has never had a photo, and Google's image URLs do expire.
 */
export function PersonAvatar({
	name,
	userId,
	image,
	size = "default",
	className,
}: {
	name: string;
	/** Omit only where there is no account behind the name — a pending
	 *  invitation, say — which renders as initials. */
	userId?: string;
	/** A photo already in hand: the signed-in user's own, off the session.
	 *  Skips the directory lookup rather than waiting for it to say the same
	 *  thing. */
	image?: string | null;
	size?: "default" | "sm" | "lg";
	className?: string;
}) {
	const orgSlug = useOrgSlug();
	const { data } = useQuery({
		...directoryQuery(orgSlug),
		select: imageByUserId,
		enabled: image === undefined && userId !== undefined,
	});
	const src = image ?? (userId ? (data?.get(userId) ?? null) : null);

	return (
		<Avatar size={size} className={className}>
			{src && (
				// Google serves profile photos from lh3.googleusercontent.com and
				// answers 403 to a request carrying a referrer it doesn't expect, so
				// the photo would load in development and break on the deployed
				// origin. `alt` is empty on purpose: the name is always rendered
				// beside it, and reading it twice helps nobody.
				<AvatarImage src={src} alt="" referrerPolicy="no-referrer" />
			)}
			<AvatarFallback>{getInitials(name)}</AvatarFallback>
		</Avatar>
	);
}

/** The name cell of a table that lists people: face, then name. */
export function PersonCell({
	name,
	userId,
	className,
	children,
}: {
	name: string;
	userId?: string;
	className?: string;
	/** Anything that belongs under the name — a person type, a warning. */
	children?: React.ReactNode;
}) {
	return (
		<span className={cn("flex min-w-0 items-center gap-2.5", className)}>
			<PersonAvatar userId={userId} name={name} size="sm" />
			<span className="min-w-0">
				<span className="block truncate font-medium">{name}</span>
				{children}
			</span>
		</span>
	);
}
