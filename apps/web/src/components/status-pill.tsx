import { Badge } from "#/components/ui/badge.tsx";

// Matches CATEGORY_COLORS' green swatch in lib/category-colors.ts.
const POSITIVE_TINT = "#e5f1e9";
const POSITIVE_TEXT = "#2f6f47";

// Shared "on" / "off" pill convention used across Projects, Entry types, and
// Recurring blocks: a soft green tint for active/billable states, a muted
// grey badge for archived/paused/non-billable states.
export function StatusPill({
	tone,
	children,
}: {
	tone: "positive" | "neutral";
	children: React.ReactNode;
}) {
	if (tone === "neutral") {
		return (
			<Badge variant="secondary" className="text-muted-foreground">
				{children}
			</Badge>
		);
	}
	return (
		<span
			className="inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 rounded-4xl px-2 py-0.5 text-xs font-medium whitespace-nowrap"
			style={{ backgroundColor: POSITIVE_TINT, color: POSITIVE_TEXT }}
		>
			{children}
		</span>
	);
}
