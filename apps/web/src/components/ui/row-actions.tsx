import { DotsThreeIcon } from "@phosphor-icons/react";

import { Button } from "#/components/ui/button.tsx";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu.tsx";
import { cn } from "#/lib/utils.ts";

export type RowAction = {
	label: string;
	onClick: () => void;
	icon?: React.ReactNode;
	disabled?: boolean;
	variant?: "default" | "destructive";
};

/** Row-level actions, declared as data rather than JSX, so this component can
 *  decide how to present them: a single action is its own labelled button (a
 *  3-dot menu hiding one item costs a click and tells you nothing), two or more
 *  collapse into the menu. Call sites express *what* can be done, not which of
 *  the two shapes to render — which is what keeps the pattern consistent as
 *  rows gain and lose actions with state (archived vs active, admin vs not).
 *
 *  Falsy entries are dropped, so conditional actions read inline:
 *  `actions={[canEdit && { label: "Edit", onClick }]}`. */
export function RowActions({
	actions,
	align = "end",
	className,
}: {
	actions: (RowAction | false | null | undefined)[];
	align?: "start" | "center" | "end";
	className?: string;
}) {
	const visible = actions.filter((a): a is RowAction => Boolean(a));
	const [action] = visible;
	if (action === undefined) return null;

	if (visible.length === 1) {
		return (
			<Button
				variant="ghost"
				size="sm"
				disabled={action.disabled}
				onClick={action.onClick}
				// Grey like its neighbours until the pointer is on it — the same rule
				// as Delete on a time entry.
				className={cn(
					action.variant === "destructive" && "hover:text-destructive",
					className,
				)}
			>
				{action.icon}
				{action.label}
			</Button>
		);
	}

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button variant="ghost" size="icon-sm" className={className}>
						<DotsThreeIcon weight="regular" />
					</Button>
				}
			/>
			<DropdownMenuContent align={align}>
				{visible.map((action) => (
					<DropdownMenuItem
						key={action.label}
						disabled={action.disabled}
						variant={action.variant}
						onClick={action.onClick}
					>
						{action.icon}
						{action.label}
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
