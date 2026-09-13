import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { type ReactElement, useState } from "react";

import { Button } from "#/components/ui/button.tsx";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#/components/ui/popover.tsx";
import {
	type CatalogueEmoji,
	EMOJI_CATEGORIES,
	searchEmoji,
} from "#/lib/emoji-catalogue.ts";
import { cn } from "#/lib/utils.ts";

// The icon picker, laid out like the Mac's: a search field, a row of
// categories, the grid, with "Recently used" — the icons the org's other
// projects already carry — first. Picking closes it; "No icon" falls back to
// the first letter of the name.
//
// Emoji only for now. A logo upload wants a file store the app does not yet
// have; when it does, it becomes a second tab here, not a second control.

export function ProjectIconPicker({
	value,
	onChange,
	recent = [],
	trigger,
}: {
	value: string | null;
	onChange: (icon: string | null) => void;
	/** Icons already in use across the org's projects, shown first. */
	recent?: string[];
	trigger: ReactElement;
}) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [category, setCategory] = useState<string | null>(null);

	const pick = (icon: string | null) => {
		onChange(icon);
		setOpen(false);
	};

	const searching = query.trim() !== "";
	const hits = searching ? searchEmoji(query) : [];
	const recentEmoji: CatalogueEmoji[] = recent
		.filter((c, i, all) => c && all.indexOf(c) === i)
		.map((char) => ({ char, name: "" }));
	const shown = category
		? EMOJI_CATEGORIES.filter((c) => c.id === category)
		: EMOJI_CATEGORIES;

	const grid = (items: CatalogueEmoji[]) => (
		<div className="grid grid-cols-9 gap-0.5">
			{items.map((e) => (
				<button
					key={e.char}
					type="button"
					title={e.name || undefined}
					aria-pressed={value === e.char}
					onClick={() => pick(e.char)}
					className={cn(
						"flex h-8 items-center justify-center rounded-md border border-transparent text-xl transition-colors duration-(--dur-fast) outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/16",
						value === e.char && "border-ring bg-primary/8",
					)}
				>
					{e.char}
				</button>
			))}
		</div>
	);

	return (
		<Popover
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (!next) {
					setQuery("");
					setCategory(null);
				}
			}}
		>
			<PopoverTrigger render={trigger} />
			<PopoverContent className="w-[22.5rem] p-2.5" align="start">
				<div className="relative">
					<MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" />
					<input
						// oxlint-disable-next-line jsx-a11y/no-autofocus -- the popover exists to be typed into; focus follows the click that opened it
						autoFocus
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Search emoji…"
						aria-label="Search emoji"
						className="h-8 w-full rounded-lg border border-input bg-transparent py-1 pr-2.5 pl-8 text-base outline-none placeholder:text-faint focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/16"
					/>
				</div>

				{!searching && (
					<div
						role="tablist"
						aria-label="Categories"
						className="mt-2 flex gap-0.5 border-b border-line2 pb-1.5"
					>
						<button
							type="button"
							role="tab"
							aria-selected={category === null}
							title="All"
							onClick={() => setCategory(null)}
							className={cn(
								"h-7 w-8 rounded-md text-sm transition-colors duration-(--dur-fast) hover:bg-muted",
								category === null && "bg-muted",
							)}
						>
							🕘
						</button>
						{EMOJI_CATEGORIES.map((c) => (
							<button
								key={c.id}
								type="button"
								role="tab"
								aria-selected={category === c.id}
								title={c.label}
								onClick={() => setCategory(c.id)}
								className={cn(
									"h-7 w-8 rounded-md text-sm opacity-60 transition-[opacity,background-color] duration-(--dur-fast) hover:bg-muted hover:opacity-100",
									category === c.id && "bg-muted opacity-100",
								)}
							>
								{c.glyph}
							</button>
						))}
					</div>
				)}

				<div className="mt-1 max-h-60 overflow-y-auto pr-0.5">
					{searching ? (
						hits.length === 0 ? (
							<p className="py-6 text-center text-sm text-muted-foreground">
								No emoji matches “{query.trim()}”.
							</p>
						) : (
							grid(hits)
						)
					) : (
						<>
							{category === null && recentEmoji.length > 0 && (
								<>
									<p className="eyebrow px-1 pt-2 pb-1.5">Recently used</p>
									{grid(recentEmoji)}
								</>
							)}
							{shown.map((c) => (
								<div key={c.id}>
									<p className="eyebrow px-1 pt-2 pb-1.5">{c.label}</p>
									{grid(c.emoji)}
								</div>
							))}
						</>
					)}
				</div>

				<div className="mt-2 flex items-center gap-2 border-t border-line2 pt-2">
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => pick(null)}
					>
						No icon
					</Button>
					<span className="text-xs text-muted-foreground">
						Uses the first letter of the name.
					</span>
				</div>
			</PopoverContent>
		</Popover>
	);
}
