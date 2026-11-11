import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { SearchInput } from "#/components/ui/search-input.tsx";
import { searchConversationsQuery } from "#/queries/assistant.ts";

const DEBOUNCE_MS = 250;
const MIN_CHARS = 2;

/** The text in pieces, with the pieces that match `q` marked. */
export function matchParts(
	text: string,
	q: string,
): { text: string; match: boolean }[] {
	const needle = q.toLowerCase();
	const haystack = text.toLowerCase();
	const parts: { text: string; match: boolean }[] = [];
	let from = 0;
	for (;;) {
		const hit = needle ? haystack.indexOf(needle, from) : -1;
		if (hit === -1) break;
		if (hit > from) parts.push({ text: text.slice(from, hit), match: false });
		parts.push({ text: text.slice(hit, hit + needle.length), match: true });
		from = hit + needle.length;
	}
	if (from < text.length) parts.push({ text: text.slice(from), match: false });
	return parts;
}

function Marked({ text, q }: { text: string; q: string }) {
	let offset = 0;
	return matchParts(text, q).map((part) => {
		offset += part.text.length;
		return part.match ? (
			<strong key={offset} className="font-semibold text-ink">
				{part.text}
			</strong>
		) : (
			<span key={offset}>{part.text}</span>
		);
	});
}

/** The search box, and the query it holds once it settles. */
export function useChatSearch() {
	const [input, setInput] = useState("");
	const [settled, setSettled] = useState("");
	useEffect(() => {
		const timer = setTimeout(() => setSettled(input.trim()), DEBOUNCE_MS);
		return () => clearTimeout(timer);
	}, [input]);
	return {
		input,
		setInput,
		// A cleared box shows the list at once, with no wait.
		query: input.trim() === "" ? "" : settled,
	};
}

export function ChatSearchBox({
	value,
	onValueChange,
}: {
	value: string;
	onValueChange: (value: string) => void;
}) {
	return (
		<SearchInput
			value={value}
			onValueChange={onValueChange}
			placeholder="Search chats"
			className="mb-1 px-1"
		/>
	);
}

/** The matches for `query`, in place of the list. */
export function ChatSearchResults({
	orgSlug,
	query,
	onNavigate,
}: {
	orgSlug: string;
	query: string;
	onNavigate?: () => void;
}) {
	const enabled = query.length >= MIN_CHARS;
	const { data = [], isPending } = useQuery({
		...searchConversationsQuery(orgSlug, query),
		enabled,
	});
	if (!enabled) {
		return (
			<p className="px-2.5 py-1 text-2xs text-muted-foreground">
				Type at least {MIN_CHARS} characters.
			</p>
		);
	}
	if (isPending) {
		return (
			<p className="px-2.5 py-1 text-2xs text-muted-foreground">Searching…</p>
		);
	}
	if (data.length === 0) {
		return (
			<p className="px-2.5 py-1 text-2xs text-muted-foreground">
				No chat matches.
			</p>
		);
	}
	return (
		<ul className="flex flex-col gap-0.5">
			{data.map((hit) => (
				<li key={hit.id}>
					<Link
						to="/$orgSlug/assistant"
						params={{ orgSlug }}
						search={{ c: hit.id }}
						onClick={onNavigate}
						className="block rounded-2xl px-2.5 py-2 hover:bg-hover-2"
					>
						<span className="block truncate text-base md:text-sm">
							<Marked text={hit.title} q={query} />
						</span>
						{hit.snippet && (
							<span className="line-clamp-2 text-2xs text-muted-foreground">
								<Marked text={hit.snippet} q={query} />
							</span>
						)}
					</Link>
				</li>
			))}
		</ul>
	);
}
