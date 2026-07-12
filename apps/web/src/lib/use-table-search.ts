import { useMemo, useState } from "react";

// Client-side search + pagination over an in-memory list. `searchable` returns
// the text a row is matched against; the page auto-clamps when filtering shrinks
// the result set so you never land on an empty page past the end.
export function useTableSearch<T>(
	items: T[],
	searchable: (item: T) => string,
	pageSize: number,
) {
	const [search, setSearchRaw] = useState("");
	const [page, setPage] = useState(1);

	// Resetting to page 1 on every new query keeps results visible instead of
	// stranding the user on a now-out-of-range page.
	const setSearch = (value: string) => {
		setSearchRaw(value);
		setPage(1);
	};

	// biome-ignore lint/correctness/useExhaustiveDependencies: searchable is a pure accessor; callers pass it inline and it never captures changing state, so keying only on items+search is correct and avoids re-filtering every render.
	const filtered = useMemo(() => {
		const q = search.trim().toLowerCase();
		if (!q) return items;
		return items.filter((item) => searchable(item).toLowerCase().includes(q));
	}, [items, search]);

	const total = filtered.length;
	const pageCount = Math.max(1, Math.ceil(total / pageSize));
	const clampedPage = Math.min(page, pageCount);
	const start = (clampedPage - 1) * pageSize;
	const paged = filtered.slice(start, start + pageSize);

	return {
		search,
		setSearch,
		page: clampedPage,
		setPage,
		pageCount,
		total,
		from: total === 0 ? 0 : start + 1,
		to: start + paged.length,
		paged,
	};
}
