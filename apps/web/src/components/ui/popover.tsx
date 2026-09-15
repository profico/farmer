"use client";

import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";

import {
	menuPopupVariants,
	type PopupPresence,
	springProductive,
	useControllableOpen,
} from "#/lib/motion.ts";
import { cn } from "#/lib/utils.ts";

// Same open-state/actionsRef bridge as dropdown-menu.tsx and dialog.tsx: the
// wrapper owns the resolved open value so AnimatePresence and Base UI are
// driven by one source of truth, and the popup is only unmounted once the exit
// animation has finished.
const PopoverPresenceContext =
	React.createContext<PopupPresence<PopoverPrimitive.Root.Actions> | null>(
		null,
	);

function Popover({
	open,
	defaultOpen,
	onOpenChange,
	children,
	...props
}: PopoverPrimitive.Root.Props) {
	const [value, setOpen] =
		useControllableOpen<PopoverPrimitive.Root.ChangeEventDetails>({
			open,
			defaultOpen,
			onOpenChange,
		});
	const actionsRef = React.useRef<PopoverPrimitive.Root.Actions | null>(null);
	const presence = React.useMemo(() => ({ open: value, actionsRef }), [value]);

	return (
		<PopoverPresenceContext.Provider value={presence}>
			<PopoverPrimitive.Root
				open={value}
				onOpenChange={setOpen}
				actionsRef={actionsRef}
				{...props}
			>
				{children}
			</PopoverPrimitive.Root>
		</PopoverPresenceContext.Provider>
	);
}

function PopoverTrigger({ ...props }: PopoverPrimitive.Trigger.Props) {
	return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverContent({
	align = "start",
	alignOffset = 0,
	side = "bottom",
	sideOffset = 6,
	className,
	...props
}: PopoverPrimitive.Popup.Props &
	Pick<
		PopoverPrimitive.Positioner.Props,
		"align" | "alignOffset" | "side" | "sideOffset"
	>) {
	const presence = React.useContext(PopoverPresenceContext);
	const open = presence?.open ?? false;
	const actionsRef = presence?.actionsRef;

	// Positioner stays mounted so Floating UI keeps owning the positioning
	// transform on its own node while motion animates scale/opacity on the
	// popup — different nodes, never fighting over `transform`.
	return (
		<PopoverPrimitive.Portal keepMounted>
			<PopoverPrimitive.Positioner
				className="isolate z-50 outline-none"
				align={align}
				alignOffset={alignOffset}
				side={side}
				sideOffset={sideOffset}
			>
				<AnimatePresence
					initial={false}
					onExitComplete={() => actionsRef?.current?.unmount()}
				>
					{open && (
						<PopoverPrimitive.Popup
							key="popover-content"
							data-slot="popover-content"
							className={cn(
								"z-50 max-h-(--available-height) origin-(--transform-origin) rounded-xl bg-popover text-popover-foreground shadow-[var(--shadow-pop)] outline-none",
								className,
							)}
							render={
								<motion.div
									variants={menuPopupVariants}
									initial="closed"
									animate="open"
									exit="closed"
									transition={springProductive}
								/>
							}
							{...props}
						/>
					)}
				</AnimatePresence>
			</PopoverPrimitive.Positioner>
		</PopoverPrimitive.Portal>
	);
}

export { Popover, PopoverTrigger, PopoverContent };
