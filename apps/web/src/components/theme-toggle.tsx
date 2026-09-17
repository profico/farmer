import { MoonIcon, SunIcon } from "@phosphor-icons/react";

import { useTheme } from "#/lib/theme.ts";
import { cn } from "#/lib/utils.ts";

/** Icon-only appearance switch. Sits beside Log out in both footers — the two
 *  things you reach for about yourself rather than about the workspace.
 *
 *  Shows the theme you'd get by clicking, not the one you're in: the button is
 *  a destination, and a sun on a light page is a statement of the obvious. */
export function ThemeToggle({
	className,
	iconClassName,
}: {
	className?: string;
	iconClassName?: string;
}) {
	const { theme, toggle } = useTheme();
	const next = theme === "dark" ? "light" : "dark";
	const Icon = theme === "dark" ? SunIcon : MoonIcon;

	return (
		<button
			type="button"
			onClick={toggle}
			title={`Switch to ${next} mode`}
			aria-label={`Switch to ${next} mode`}
			className={cn("quiet shrink-0", className)}
		>
			<Icon weight="fill" className={cn("size-3.75", iconClassName)} />
		</button>
	);
}
