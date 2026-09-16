"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { XIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";

import { Button } from "#/components/ui/button.tsx";
import {
	backdropVariants,
	dialogPopupVariants,
	type PopupPresence,
	springExpressive,
	springProductive,
	useControllableOpen,
} from "#/lib/motion.ts";
import { cn } from "#/lib/utils.ts";

// The wrapper owns open-state (Base UI's own context only exposes an internal
// store, not a boolean) and shares it — plus the actionsRef used to finalize
// unmount after the exit spring — with DialogContent. Every call site keeps
// passing `open`/`onOpenChange`/`defaultOpen` to <Dialog> unchanged.
const DialogPresenceContext =
	React.createContext<PopupPresence<DialogPrimitive.Root.Actions> | null>(null);

function Dialog({
	open,
	defaultOpen,
	onOpenChange,
	children,
	...props
}: DialogPrimitive.Root.Props) {
	const [value, setOpen] =
		useControllableOpen<DialogPrimitive.Root.ChangeEventDetails>({
			open,
			defaultOpen,
			onOpenChange,
		});
	const actionsRef = React.useRef<DialogPrimitive.Root.Actions | null>(null);
	const presence = React.useMemo(() => ({ open: value, actionsRef }), [value]);

	return (
		<DialogPresenceContext.Provider value={presence}>
			<DialogPrimitive.Root
				data-slot="dialog"
				open={value}
				onOpenChange={setOpen}
				actionsRef={actionsRef}
				{...props}
			>
				{children}
			</DialogPrimitive.Root>
		</DialogPresenceContext.Provider>
	);
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
	return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
	return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
	return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({
	className,
	...props
}: DialogPrimitive.Backdrop.Props) {
	return (
		<DialogPrimitive.Backdrop
			data-slot="dialog-overlay"
			className={cn(
				"fixed inset-0 isolate z-50 bg-black/25 supports-backdrop-filter:backdrop-blur-xs",
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

function DialogContent({
	className,
	children,
	showCloseButton = true,
	...props
}: DialogPrimitive.Popup.Props & {
	showCloseButton?: boolean;
}) {
	const presence = React.useContext(DialogPresenceContext);
	if (!presence) {
		throw new Error("DialogContent must be used within <Dialog>");
	}
	const { open, actionsRef } = presence;

	return (
		// keepMounted holds Base UI's portal/scroll-lock/focus infra alive across
		// the close so the exit spring can play; AnimatePresence owns DOM removal
		// and, once both children finish exiting, actionsRef.unmount() tears the
		// portal down. Unmount lives on onExitComplete (not a per-element
		// onAnimationComplete guarded by !open): an exiting child is a clone frozen
		// with open===true, so that guard would never fire.
		<DialogPrimitive.Portal keepMounted>
			<AnimatePresence
				initial={false}
				onExitComplete={() => actionsRef.current?.unmount()}
			>
				{open && <DialogOverlay key="dialog-overlay" />}
				{open && (
					<DialogPrimitive.Popup
						key="dialog-content"
						data-slot="dialog-content"
						// top/left-1/2 anchors; centering translate lives in the motion
						// variants (x/y: -50%) because motion owns the transform.
						//
						// The popup itself never scrolls and is capped at the viewport
						// minus the same 1rem gutter the width uses: the padding, the
						// scrolling and the sticky footer all live on the inner body, so
						// the close button (absolute against the popup) and the footer
						// stay put while a tall form scrolls under them.
						className={cn(
							"fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100*var(--dvh)-2rem)] w-full max-w-[calc(100%-2rem)] flex-col overflow-hidden rounded-xl border border-border shadow-[var(--shadow-pop)] bg-popover text-base text-popover-foreground outline-none sm:max-w-lg",
							className,
						)}
						render={
							<motion.div
								variants={dialogPopupVariants}
								initial="closed"
								animate="open"
								exit="closed"
								transition={springExpressive}
							/>
						}
						{...props}
					>
						<div
							data-slot="dialog-body"
							// `grid-cols-[minmax(0,1fr)]`, not a bare `grid`: an implicit
							// grid column is `auto`-sized and its items get `min-width:
							// auto`, so one long unbroken string — a commit subject, a
							// squashed-PR title — widened the column past the popup and
							// took every sibling with it. The popup clips, so the header's
							// copy, the rows and the sticky footer all ran off the right
							// edge. Pinning the column to the container is what lets the
							// `min-w-0 truncate` the rows already carry actually bite.
							className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] gap-4 overflow-y-auto p-6"
						>
							{children}
						</div>
						{showCloseButton && (
							<DialogPrimitive.Close
								data-slot="dialog-close"
								render={
									<Button
										variant="ghost"
										className="absolute top-2 right-2"
										size="icon-sm"
									/>
								}
							>
								<XIcon weight="regular" />
								<span className="sr-only">Close</span>
							</DialogPrimitive.Close>
						)}
					</DialogPrimitive.Popup>
				)}
			</AnimatePresence>
		</DialogPrimitive.Portal>
	);
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="dialog-header"
			className={cn("flex flex-col gap-2", className)}
			{...props}
		/>
	);
}

function DialogFooter({
	className,
	showCloseButton = false,
	children,
	...props
}: React.ComponentProps<"div"> & {
	showCloseButton?: boolean;
}) {
	return (
		<div
			data-slot="dialog-footer"
			// Sticky rather than merely last: the body it sits in is the scrollport,
			// so on a form taller than the viewport the actions stay reachable
			// instead of scrolling off the bottom. `bg-popover` is what stops the
			// scrolled content showing through it.
			//
			// `-bottom-6` (not `bottom-0`): the sticky inset resolves against the
			// scroll container's CONTENT box, which the body's `p-6` sits 1.5rem
			// inside of — the same 1.5rem the `-mb-6` bleed already spends. Pinning
			// at 0 parks the footer that far above the popup's edge and leaves a
			// stripe of scrolled content showing underneath it.
			className={cn(
				"-mx-6 -mb-6 -bottom-6 sticky z-10 mt-1 flex shrink-0 flex-col-reverse gap-2 rounded-b-xl border-t border-line2 bg-popover p-4 px-6 sm:flex-row sm:justify-end",
				className,
			)}
			{...props}
		>
			{children}
			{showCloseButton && (
				<DialogPrimitive.Close render={<Button variant="outline" />}>
					Close
				</DialogPrimitive.Close>
			)}
		</div>
	);
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
	return (
		<DialogPrimitive.Title
			data-slot="dialog-title"
			className={cn("h2 pr-6", className)}
			{...props}
		/>
	);
}

function DialogDescription({
	className,
	...props
}: DialogPrimitive.Description.Props) {
	return (
		<DialogPrimitive.Description
			data-slot="dialog-description"
			className={cn(
				"text-base leading-normal text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
				className,
			)}
			{...props}
		/>
	);
}

export {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogOverlay,
	DialogPortal,
	DialogTitle,
	DialogTrigger,
};
