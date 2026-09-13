import { cn } from "#/lib/utils.ts";

// Shared status pill used across Projects, Tasks, Recurring blocks, the import
// runs and Tracking: green for settled states, amber for "waiting on someone"
// or "slightly behind", the accent for "behind" — the palette's one strong
// colour, the same one the destructive button wears — and the plain hover tint
// for inactive/archived/open ones.
//
// Every tone is mixed from a palette token rather than written as a hex, so a
// pill can't drift away from the rest of the page — and follows the palette if
// the app is ever wearing a different one.
const TONES = {
	positive: "bg-ok/12 text-ok",
	warning: "bg-warn/12 text-warn",
	negative: "bg-destructive/12 text-destructive",
	neutral: "bg-muted text-muted-foreground",
} as const;

export function StatusPill({
	tone,
	children,
}: {
	tone: keyof typeof TONES;
	children: React.ReactNode;
}) {
	return (
		<span
			className={cn(
				"inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
				TONES[tone],
			)}
		>
			{children}
		</span>
	);
}
