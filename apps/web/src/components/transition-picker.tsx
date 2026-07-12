import { Check } from "lucide-react";
import type { PageTransition } from "#/lib/preferences.ts";
import { cn } from "#/lib/utils.ts";

const OPTIONS: { value: PageTransition; label: string }[] = [
	{ value: "none", label: "None" },
	{ value: "fade", label: "Fade" },
	{ value: "slide", label: "Slide" },
	{ value: "zoom", label: "Zoom" },
];

export function TransitionPicker({
	value,
	onChange,
}: {
	value: PageTransition;
	onChange: (value: PageTransition) => void;
}) {
	return (
		<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
			{OPTIONS.map((option) => {
				const selected = value === option.value;
				return (
					<button
						key={option.value}
						type="button"
						onClick={() => onChange(option.value)}
						className={cn(
							"group rounded-lg border p-2 text-left transition-colors",
							selected
								? "border-primary bg-primary/5"
								: "border-border hover:border-foreground/30",
						)}
					>
						<div className="relative h-16 overflow-hidden rounded-md bg-muted">
							<PreviewSheet variant={option.value} slot="old" />
							<PreviewSheet variant={option.value} slot="new" />
						</div>
						<div className="mt-2 flex items-center gap-1.5 text-sm font-medium">
							{option.label}
							{selected && <Check className="size-3.5 shrink-0 text-primary" />}
						</div>
					</button>
				);
			})}
		</div>
	);
}

// Two stacked "pages" per card, looping through that style's transition on
// hover (animation-play-state toggled via group-hover — see styles.css for
// the preview-{old,new}-{variant} keyframes). `animationName` is set inline
// since Tailwind can't resolve a template-literal class at build time.
//
// "none" means no transition ever plays, so it gets no keyframes at all —
// the old sheet just sits fully visible and the new one fully hidden. That
// reads as "nothing animates," instead of faking a near-instant flicker that
// looked the same as "fade" at this animation's speed and box size.
function PreviewSheet({
	variant,
	slot,
}: {
	variant: PageTransition;
	slot: "old" | "new";
}) {
	const animated = variant !== "none";
	return (
		<div
			style={
				animated ? { animationName: `preview-${slot}-${variant}` } : undefined
			}
			className={cn(
				"absolute inset-0 flex flex-col justify-center gap-1 rounded-md p-2",
				animated
					? "[animation-duration:1.6s] [animation-iteration-count:infinite] [animation-timing-function:ease-in-out] [animation-play-state:paused] group-hover:[animation-play-state:running] [@media(hover:none)]:[animation-play-state:running]"
					: slot === "old"
						? "opacity-100"
						: "opacity-0",
				slot === "old" ? "bg-primary/15" : "bg-primary/35",
			)}
		>
			<div
				className={cn(
					"h-1.5 rounded-full",
					slot === "old" ? "w-8 bg-foreground/20" : "w-10 bg-foreground/30",
				)}
			/>
			<div
				className={cn(
					"h-1.5 rounded-full",
					slot === "old" ? "w-12 bg-foreground/15" : "w-14 bg-foreground/25",
				)}
			/>
			<div
				className={cn(
					"h-1.5 rounded-full",
					slot === "old" ? "w-6 bg-foreground/15" : "w-7 bg-foreground/25",
				)}
			/>
		</div>
	);
}
