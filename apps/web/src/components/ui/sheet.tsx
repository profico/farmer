"use client";

import { Dialog as SheetPrimitive } from "@base-ui/react/dialog";
import { XIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import { Button } from "#/components/ui/button.tsx";
import {
	backdropVariants,
	type PopupPresence,
	type SheetSide,
	sheetVariants,
	springProductive,
	springSheet,
	useControllableOpen,
} from "#/lib/motion.ts";
import { cn } from "#/lib/utils.ts";

// Same wrapper-owns-open-state bridge as Dialog (see dialog.tsx) — the Sheet
// uses Base UI's dialog primitive under the hood, so the pattern is identical;
// only the motion variant differs (edge slide instead of centered scale).
const SheetPresenceContext =
	React.createContext<PopupPresence<SheetPrimitive.Root.Actions> | null>(null);

function Sheet({
	open,
	defaultOpen,
	onOpenChange,
	children,
	...props
}: SheetPrimitive.Root.Props) {
	const [value, setOpen] =
		useControllableOpen<SheetPrimitive.Root.ChangeEventDetails>({
			open,
			defaultOpen,
			onOpenChange,
		});
	const actionsRef = React.useRef<SheetPrimitive.Root.Actions | null>(null);
	const presence = React.useMemo(() => ({ open: value, actionsRef }), [value]);

	return (
		<SheetPresenceContext.Provider value={presence}>
			<SheetPrimitive.Root
				data-slot="sheet"
				open={value}
				onOpenChange={setOpen}
				actionsRef={actionsRef}
				{...props}
			>
				{children}
			</SheetPrimitive.Root>
		</SheetPresenceContext.Provider>
	);
}

function SheetTrigger({ ...props }: SheetPrimitive.Trigger.Props) {
	return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose({ ...props }: SheetPrimitive.Close.Props) {
	return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetPortal({ ...props }: SheetPrimitive.Portal.Props) {
	return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />;
}

function SheetOverlay({ className, ...props }: SheetPrimitive.Backdrop.Props) {
	return (
		<SheetPrimitive.Backdrop
			data-slot="sheet-overlay"
			className={cn(
				"fixed inset-0 z-50 bg-black/10 supports-backdrop-filter:backdrop-blur-xs",
				className,
			)}
			render={
				<motion.div
					variants={backdropVariants}
					initial="closed"
					animate="open"
					exit="closed"
					transition={springProductive}
				/>
			}
			{...props}
		/>
	);
}

function SheetContent({
	className,
	children,
	side = "right",
	showCloseButton = true,
	...props
}: SheetPrimitive.Popup.Props & {
	side?: SheetSide;
	showCloseButton?: boolean;
}) {
	const presence = React.useContext(SheetPresenceContext);
	if (!presence) {
		throw new Error("SheetContent must be used within <Sheet>");
	}
	const { open, actionsRef } = presence;

	return (
		<SheetPortal keepMounted>
			<AnimatePresence
				initial={false}
				onExitComplete={() => actionsRef.current?.unmount()}
			>
				{open && <SheetOverlay key="sheet-overlay" />}
				{open && (
					<SheetPrimitive.Popup
						key="sheet-content"
						data-slot="sheet-content"
						data-side={side}
						// Layout/position/border only — motion owns the transform; the enter
						// and exit slide both travel the same edge (sheetVariants[side]).
						className={cn(
							"fixed z-50 flex flex-col gap-4 bg-popover bg-clip-padding text-sm text-popover-foreground shadow-lg outline-none data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:h-auto data-[side=bottom]:border-t data-[side=left]:inset-y-0 data-[side=left]:left-0 data-[side=left]:h-full data-[side=left]:w-3/4 data-[side=left]:border-r data-[side=right]:inset-y-0 data-[side=right]:right-0 data-[side=right]:h-full data-[side=right]:w-3/4 data-[side=right]:border-l data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:h-auto data-[side=top]:border-b data-[side=left]:sm:max-w-sm data-[side=right]:sm:max-w-sm",
							className,
						)}
						render={
							<motion.div
								variants={sheetVariants[side]}
								initial="closed"
								animate="open"
								exit="closed"
								transition={springSheet}
							/>
						}
						{...props}
					>
						{children}
						{showCloseButton && (
							<SheetPrimitive.Close
								data-slot="sheet-close"
								render={
									<Button
										variant="ghost"
										className="absolute top-3 right-3"
										size="icon-sm"
									/>
								}
							>
								<XIcon />
								<span className="sr-only">Close</span>
							</SheetPrimitive.Close>
						)}
					</SheetPrimitive.Popup>
				)}
			</AnimatePresence>
		</SheetPortal>
	);
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="sheet-header"
			className={cn("flex flex-col gap-0.5 p-4", className)}
			{...props}
		/>
	);
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="sheet-footer"
			className={cn("mt-auto flex flex-col gap-2 p-4", className)}
			{...props}
		/>
	);
}

function SheetTitle({ className, ...props }: SheetPrimitive.Title.Props) {
	return (
		<SheetPrimitive.Title
			data-slot="sheet-title"
			className={cn("text-base font-medium text-foreground", className)}
			{...props}
		/>
	);
}

function SheetDescription({
	className,
	...props
}: SheetPrimitive.Description.Props) {
	return (
		<SheetPrimitive.Description
			data-slot="sheet-description"
			className={cn("text-sm text-muted-foreground", className)}
			{...props}
		/>
	);
}

export {
	Sheet,
	SheetTrigger,
	SheetClose,
	SheetContent,
	SheetHeader,
	SheetFooter,
	SheetTitle,
	SheetDescription,
};
