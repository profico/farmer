import { matchesSearch } from "@farmer/core/lib/search";

// The project icon picker's catalogue: every emoji Unicode has, from
// `emojibase-data`, grouped the way the Mac's picker groups it, each with the
// words people search by. It used to be a hand-picked slice of ~180, which is
// the list somebody thought of rather than the one people look for.
//
// The data is ~570KB of JSON, so it is a dynamic import: loaded the first
// time a picker opens (or is hovered), never on a page that only shows icons.
// Emojibase's "component" group (bare skin-tone swatches, hair pieces) and
// the ungrouped regional indicators are left out — neither is an emoji on its
// own.

export type CatalogueEmoji = {
	char: string;
	/** Emojibase's label, shown on hover. */
	name: string;
	/** The label plus its tags, what search reads. */
	keywords: string;
	/** The five single-tone variants, light to dark, when the emoji has them. */
	skins?: string[];
};
export type EmojiCategory = {
	id: string;
	label: string;
	/** The emoji that stands for the category in the picker's row. */
	glyph: string;
	emoji: CatalogueEmoji[];
};

// Emojibase's group numbers (emojibase-data/meta/groups.json), in its order.
const GROUPS = [
	{ group: 0, id: "smileys", label: "Smileys & emotion", glyph: "😀" },
	{ group: 1, id: "people", label: "People & body", glyph: "👋" },
	{ group: 3, id: "animals", label: "Animals & nature", glyph: "🐶" },
	{ group: 4, id: "food", label: "Food & drink", glyph: "🍕" },
	{ group: 5, id: "travel", label: "Travel & places", glyph: "✈️" },
	{ group: 6, id: "activities", label: "Activities", glyph: "⚽" },
	{ group: 7, id: "objects", label: "Objects", glyph: "💡" },
	{ group: 8, id: "symbols", label: "Symbols", glyph: "⭐" },
	{ group: 9, id: "flags", label: "Flags", glyph: "🏁" },
] as const;

/** The Fitzpatrick modifiers, light to dark, as emojibase writes hexcodes. */
const SKIN_TONES: readonly string[] = [
	"1F3FB",
	"1F3FC",
	"1F3FD",
	"1F3FE",
	"1F3FF",
];

type Row = {
	hexcode: string;
	label: string;
	unicode: string;
	group?: number;
	order?: number;
	tags?: string[];
	skins?: Row[];
};

// Which tone a variant is, or -1 for a mixed one. A couple emoji carries a
// variant for every pairing of tones; the picker's one tone setting can only
// mean the variant where every person has it.
const toneOf = (hexcode: string) => {
	const tones = hexcode.split("-").filter((part) => SKIN_TONES.includes(part));
	const first = tones[0];
	return first !== undefined && tones.every((t) => t === first)
		? SKIN_TONES.indexOf(first)
		: -1;
};

const toEmoji = (row: Row): CatalogueEmoji => {
	const skins = SKIN_TONES.map(
		(_, tone) => row.skins?.find((s) => toneOf(s.hexcode) === tone)?.unicode,
	);
	return {
		char: row.unicode,
		name: row.label,
		keywords: [row.label, ...(row.tags ?? [])].join(" "),
		...(skins.every((s): s is string => s !== undefined) && { skins }),
	};
};

const build = (rows: Row[]): EmojiCategory[] => {
	const sorted = [...rows].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
	return GROUPS.map(({ group, id, label, glyph }) => ({
		id,
		label,
		glyph,
		emoji: sorted.filter((r) => r.group === group).map(toEmoji),
	}));
};

let loaded: EmojiCategory[] | null = null;
let loading: Promise<EmojiCategory[]> | null = null;

/** The catalogue if it has already arrived, so a reopened picker paints it at once. */
export const loadedEmojiCatalogue = () => loaded;

/** Fetches the catalogue once; a failed load is forgotten, so the next open retries. */
export const loadEmojiCatalogue = (): Promise<EmojiCategory[]> => {
	loading ??= import("emojibase-data/en/compact.json")
		.then(({ default: rows }) => {
			loaded = build(rows);
			return loaded;
		})
		.catch((error) => {
			loading = null;
			throw error;
		});
	return loading;
};

/**
 * Search across every category: every word of the query must appear in the
 * emoji's label or tags, as in every other search box. Pasting the emoji
 * itself finds it too.
 */
export const searchEmoji = (
	categories: EmojiCategory[],
	query: string,
): CatalogueEmoji[] => {
	const q = query.trim();
	if (q === "") return [];
	return categories.flatMap((c) =>
		c.emoji.filter((e) => e.char === q || matchesSearch(q, [e.keywords])),
	);
};
