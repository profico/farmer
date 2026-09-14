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
	type EmojiCategory,
	loadEmojiCatalogue,
	loadedEmojiCatalogue,
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
//
// The catalogue is every emoji there is, fetched on first hover or open (see
// lib/emoji-catalogue.ts). The tone row applies to every emoji that has
// variants, and outlives the popover for as long as the page does.

/** A raised hand in each tone, default first — the tone row's swatches. */
const TONE_SWATCHES = ["✋", "✋🏻", "✋🏼", "✋🏽", "✋🏾", "✋🏿"] as const;

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
	const [categories, setCategories] = useState<EmojiCategory[] | null>(
		loadedEmojiCatalogue,
	);
	const [failed, setFailed] = useState(false);
	// 0 is the default yellow; 1–5 index into an emoji's `skins`.
	const [tone, setTone] = useState(0);

	const load = () => {
		if (categories) return;
		setFailed(false);
		loadEmojiCatalogue().then(setCategories, () => setFailed(true));
	};

	const pick = (icon: string | null) => {
		onChange(icon);
		setOpen(false);
	};

	const searching = query.trim() !== "";
	const hits = searching && categories ? searchEmoji(categories, query) : [];
	const names = new Map(
		categories?.flatMap((c) => c.emoji.map((e) => [e.char, e.name] as const)),
	);
	const recentEmoji: CatalogueEmoji[] = recent
		.filter((c, i, all) => c && all.indexOf(c) === i)
		.map((char) => ({ char, name: names.get(char) ?? "", keywords: "" }));
	const shown = category
		? categories?.filter((c) => c.id === category)
		: categories;

	const grid = (items: CatalogueEmoji[], toned: boolean) => (
		<div className="grid grid-cols-9 gap-0.5">
			{items.map((e) => {
				const char = (toned && tone > 0 && e.skins?.[tone - 1]) || e.char;
				return (
					<button
						key={char}
						type="button"
						title={e.name || undefined}
						aria-label={e.name || undefined}
						aria-pressed={value === char}
						onClick={() => pick(char)}
						className={cn(
							"flex h-8 items-center justify-center rounded-md border border-transparent text-xl transition-colors duration-(--dur-fast) outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/16",
							value === char && "border-ring bg-primary/8",
						)}
					>
						{char}
					</button>
				);
			})}
		</div>
	);

	const status = (message: string) => (
		<p className="py-6 text-center text-sm text-muted-foreground">{message}</p>
	);

	return (
		<Popover
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (next) load();
				else {
					setQuery("");
					setCategory(null);
				}
			}}
		>
			<PopoverTrigger render={trigger} onPointerEnter={load} />
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

				{!searching && categories && (
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
						{categories.map((c) => (
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
					{!categories ? (
						status(failed ? "Could not load the emoji." : "Loading emoji…")
					) : searching ? (
						hits.length === 0 ? (
							status(`No emoji matches “${query.trim()}”.`)
						) : (
							grid(hits, true)
						)
					) : (
						<>
							{category === null && recentEmoji.length > 0 && (
								<>
									<p className="eyebrow px-1 pt-2 pb-1.5">Recently used</p>
									{grid(recentEmoji, false)}
								</>
							)}
							{shown?.map((c) => (
								// Nearly two thousand buttons: a section scrolled out of
								// view is skipped at layout and paint until it comes back.
								<div
									key={c.id}
									className="[contain-intrinsic-size:auto_24rem] [content-visibility:auto]"
								>
									<p className="eyebrow px-1 pt-2 pb-1.5">{c.label}</p>
									{grid(c.emoji, true)}
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
						title="Uses the first letter of the name."
						onClick={() => pick(null)}
					>
						No icon
					</Button>
					<div className="ml-auto flex gap-0.5">
						{TONE_SWATCHES.map((swatch, i) => (
							<button
								key={swatch}
								type="button"
								aria-pressed={tone === i}
								aria-label={i === 0 ? "Default skin tone" : `Skin tone ${i}`}
								onClick={() => setTone(i)}
								className={cn(
									"flex size-7 items-center justify-center rounded-md border border-transparent text-base transition-colors duration-(--dur-fast) hover:bg-muted",
									tone === i && "border-ring bg-primary/8",
								)}
							>
								{swatch}
							</button>
						))}
					</div>
				</div>
			</PopoverContent>
		</Popover>
	);
}
