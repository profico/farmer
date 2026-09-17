import { cn } from "#/lib/utils.ts";

export type PillToggleItem = {
	id: string;
	label: string;
	/** Muted suffix inside the pill — a client name, an "Archived" marker. */
	hint?: string;
};

/** A wrap-around row of toggleable pills over a small fixed set. Used wherever
 *  the choice is "which of these does this one opt into" and the list is short
 *  enough to show whole — a multi-select showing five of forty options behind a
 *  dropdown hides exactly the thing you are trying to judge.
 *
 *  Deliberately uncontrolled-free: the caller owns the selected ids, because
 *  every call site already keeps a draft to diff against a saved baseline. */
export function PillToggleGroup({
	items,
	selectedIds,
	onToggle,
	disabled,
	className,
}: {
	items: PillToggleItem[];
	selectedIds: string[];
	onToggle: (id: string) => void;
	disabled?: boolean;
	className?: string;
}) {
	const selected = new Set(selectedIds);

	return (
		<div className={cn("flex flex-wrap gap-1.5", className)}>
			{items.map((item) => {
				const on = selected.has(item.id);

				return (
					<button
						key={item.id}
						type="button"
						aria-pressed={on}
						disabled={disabled}
						onClick={() => onToggle(item.id)}
						className={cn(
							"rounded-full border px-3 py-1.5 text-xs transition-colors duration-(--dur-fast)",
							"disabled:pointer-events-none disabled:opacity-50",
							on
								? "border-primary/40 bg-primary/8 font-medium text-primary"
								: "border-border text-muted-foreground hover:bg-muted",
						)}
					>
						{item.label}
						{item.hint && (
							<span className={cn("ml-1.5", on ? "opacity-70" : "text-faint")}>
								{item.hint}
							</span>
						)}
					</button>
				);
			})}
		</div>
	);
}
