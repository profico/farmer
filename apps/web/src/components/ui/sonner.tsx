import {
	CheckCircleIcon,
	CircleNotchIcon,
	InfoIcon,
	WarningIcon,
	WarningOctagonIcon,
} from "@phosphor-icons/react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

import { useTheme } from "#/lib/theme.ts";

const Toaster = ({ ...props }: ToasterProps) => {
	const { theme } = useTheme();

	return (
		<Sonner
			// Every color below is a token that already flips with `data-theme`,
			// so this only decides which of Sonner's own defaults it starts from —
			// but leaving it pinned to light left the close button and the swipe
			// affordance drawn for a white toast.
			theme={theme}
			className="toaster group"
			icons={{
				success: <CheckCircleIcon weight="regular" className="size-4" />,
				info: <InfoIcon className="size-4" />,
				warning: <WarningIcon className="size-4" />,
				error: <WarningOctagonIcon className="size-4" />,
				loading: <CircleNotchIcon className="size-4 animate-spin" />,
			}}
			// SAFETY: CSS custom properties are not in React's `CSSProperties`, and there
			// is no way to declare one — this is the documented sonner theming shape.
			style={
				{
					"--normal-bg": "var(--popover)",
					"--normal-text": "var(--popover-foreground)",
					"--normal-border": "var(--border)",
					// A toast is off the page, so it takes the same pair of shadows
					// every menu and dialog takes — the app's one "floating" look.
					"--border-radius": "7px",
					"--success-bg": "var(--popover)",
					"--success-text": "var(--ok)",
					"--success-border": "var(--border)",
					"--error-bg": "var(--popover)",
					"--error-text": "var(--destructive)",
					"--error-border": "var(--border)",
					"--warning-bg": "var(--popover)",
					"--warning-text": "var(--warn)",
					"--warning-border": "var(--border)",
				} as React.CSSProperties
			}
			toastOptions={{
				classNames: {
					toast: "cn-toast text-base shadow-[var(--shadow-pop)]",
					// Sonner's default action is a filled near-black pill, the only
					// one in the app. Undo is a word, like Edit and Delete on the row
					// the toast is talking about.
					actionButton:
						"!bg-transparent !text-primary !h-auto !px-0 !font-medium underlined",
				},
			}}
			{...props}
		/>
	);
};

export { Toaster };
