import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog";
import { Drawer as DrawerPrimitive } from "@base-ui/react/drawer";
import type * as React from "react";

import { Button } from "#/components/ui/button.tsx";
import { DrawerContent } from "#/components/ui/drawer.tsx";
import {
	type ModalChangeEventDetails,
	ModalModeContext,
	sheetBodyClassName,
	sheetFooterClassName,
	sheetPopupClassName,
	useModalMode,
	useModalModeContext,
} from "#/components/ui/modal-mode.ts";
import { useControllableOpen } from "#/lib/motion.ts";
import { cn } from "#/lib/utils.ts";

type AlertDialogProps = Omit<
	AlertDialogPrimitive.Root.Props,
	"onOpenChange"
> & {
	onOpenChange?: (open: boolean, details: ModalChangeEventDetails) => void;
};

// On a phone a confirmation is a bottom sheet, as a Dialog is (see
// `modal-mode.ts`). The wrapper owns the open state, because the mode has to
// lock in the render that opens the root, and some call sites leave the state
// to the Trigger.
//
// The sheet keeps the two rules of an alert dialog that Base UI applies only
// in its own root: a tap on the backdrop does not dismiss it
// (`disablePointerDismissal`), and the popup keeps `role="alertdialog"` (see
// AlertDialogContent). A swipe down still cancels, as the Cancel button does.
function AlertDialog({
	open,
	defaultOpen,
	onOpenChange,
	onOpenChangeComplete,
	children,
	handle,
	...props
}: AlertDialogProps) {
	const [value, setOpen] = useControllableOpen<ModalChangeEventDetails>({
		open,
		defaultOpen,
		onOpenChange,
	});
	const { mode, release } = useModalMode(value);
	const handleOpenChangeComplete = (next: boolean) => {
		if (!next) release();
		onOpenChangeComplete?.(next);
	};

	return (
		<ModalModeContext.Provider value={mode}>
			{mode === "drawer" ? (
				<DrawerPrimitive.Root
					data-slot="alert-dialog"
					{...props}
					open={value}
					onOpenChange={setOpen}
					onOpenChangeComplete={handleOpenChangeComplete}
					disablePointerDismissal
				>
					{children}
				</DrawerPrimitive.Root>
			) : (
				<AlertDialogPrimitive.Root
					data-slot="alert-dialog"
					{...props}
					handle={handle}
					open={value}
					onOpenChange={setOpen}
					onOpenChangeComplete={handleOpenChangeComplete}
				>
					{children}
				</AlertDialogPrimitive.Root>
			)}
		</ModalModeContext.Provider>
	);
}

function AlertDialogTrigger({ ...props }: AlertDialogPrimitive.Trigger.Props) {
	return (
		<AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />
	);
}

function AlertDialogPortal({ ...props }: AlertDialogPrimitive.Portal.Props) {
	return (
		<AlertDialogPrimitive.Portal data-slot="alert-dialog-portal" {...props} />
	);
}

function AlertDialogOverlay({
	className,
	...props
}: AlertDialogPrimitive.Backdrop.Props) {
	return (
		<AlertDialogPrimitive.Backdrop
			data-slot="alert-dialog-overlay"
			className={cn(
				"fixed inset-0 isolate z-50 bg-black/25 duration-(--dur-base) ease-(--ease-out) supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
				className,
			)}
			{...props}
		/>
	);
}

function AlertDialogContent({
	className,
	size = "default",
	children,
	...props
}: Omit<AlertDialogPrimitive.Popup.Props, "className" | "render" | "style"> & {
	className?: string;
	size?: "default" | "sm";
}) {
	const mode = useModalModeContext();

	if (mode === "drawer") {
		// The same sheet as a Dialog on a phone (see the class names in
		// modal-mode.ts), at the width of this dialog above `sm`. The group name and
		// `data-size` stay, because the header, the media and the title select
		// on them. There is no close button: the footer has Cancel.
		return (
			<DrawerPrimitive.VirtualKeyboardProvider>
				<DrawerContent
					data-slot="alert-dialog-content"
					data-size={size}
					role="alertdialog"
					showCloseButton={false}
					className={cn(
						"group/alert-dialog-content",
						sheetPopupClassName,
						"sm:max-w-md",
						className,
					)}
					{...props}
				>
					<div data-slot="alert-dialog-body" className={sheetBodyClassName}>
						{children}
					</div>
				</DrawerContent>
			</DrawerPrimitive.VirtualKeyboardProvider>
		);
	}

	return (
		<AlertDialogPortal>
			<AlertDialogOverlay />
			<AlertDialogPrimitive.Popup
				data-slot="alert-dialog-content"
				data-size={size}
				// Same split as Dialog (see dialog.tsx): the popup is capped and never
				// scrolls, the body inside it does, so a long confirmation message
				// can't push the confirm button off-screen.
				className={cn(
					"group/alert-dialog-content fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100*var(--dvh)-2rem)] w-full -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-border shadow-[var(--shadow-pop)] bg-popover text-base text-popover-foreground duration-(--dur-slow) ease-(--ease-out) outline-none data-[size=default]:max-w-sm data-[size=sm]:max-w-xs data-[size=default]:sm:max-w-md data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
					className,
				)}
				{...props}
			>
				<div
					data-slot="alert-dialog-body"
					className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] gap-4 overflow-y-auto p-6"
				>
					{children}
				</div>
			</AlertDialogPrimitive.Popup>
		</AlertDialogPortal>
	);
}

function AlertDialogHeader({
	className,
	...props
}: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="alert-dialog-header"
			className={cn(
				"grid grid-rows-[auto_1fr] place-items-center gap-1.5 text-center has-data-[slot=alert-dialog-media]:grid-rows-[auto_auto_1fr] has-data-[slot=alert-dialog-media]:gap-x-4 sm:group-data-[size=default]/alert-dialog-content:place-items-start sm:group-data-[size=default]/alert-dialog-content:text-left sm:group-data-[size=default]/alert-dialog-content:has-data-[slot=alert-dialog-media]:grid-rows-[auto_1fr]",
				className,
			)}
			{...props}
		/>
	);
}

function AlertDialogFooter({
	className,
	...props
}: React.ComponentProps<"div">) {
	const mode = useModalModeContext();
	return (
		<div
			data-slot="alert-dialog-footer"
			// In a sheet, the footer of `sheetFooterClassName` (modal-mode.ts).
			className={cn(
				mode === "drawer"
					? sheetFooterClassName
					: "-mx-6 -mb-6 -bottom-6 sticky z-10 mt-1 flex shrink-0 flex-col-reverse gap-2 rounded-b-xl border-t border-line2 bg-popover p-4 px-6 group-data-[size=sm]/alert-dialog-content:grid group-data-[size=sm]/alert-dialog-content:grid-cols-2 sm:flex-row sm:justify-end",
				className,
			)}
			{...props}
		/>
	);
}

function AlertDialogMedia({
	className,
	...props
}: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="alert-dialog-media"
			className={cn(
				"mb-2 inline-flex size-10 items-center justify-center rounded-md bg-muted sm:group-data-[size=default]/alert-dialog-content:row-span-2 *:[svg:not([class*='size-'])]:size-6",
				className,
			)}
			{...props}
		/>
	);
}

function AlertDialogTitle({
	className,
	...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
	return (
		<AlertDialogPrimitive.Title
			data-slot="alert-dialog-title"
			className={cn(
				"text-base font-medium sm:group-data-[size=default]/alert-dialog-content:group-has-data-[slot=alert-dialog-media]/alert-dialog-content:col-start-2",
				className,
			)}
			{...props}
		/>
	);
}

function AlertDialogDescription({
	className,
	...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
	return (
		<AlertDialogPrimitive.Description
			data-slot="alert-dialog-description"
			className={cn(
				"text-sm text-balance text-muted-foreground md:text-pretty *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
				className,
			)}
			{...props}
		/>
	);
}

function AlertDialogAction({
	className,
	...props
}: React.ComponentProps<typeof Button>) {
	return (
		<Button
			data-slot="alert-dialog-action"
			className={cn(className)}
			{...props}
		/>
	);
}

function AlertDialogCancel({
	className,
	variant = "outline",
	size = "default",
	...props
}: AlertDialogPrimitive.Close.Props &
	Pick<React.ComponentProps<typeof Button>, "variant" | "size">) {
	return (
		<AlertDialogPrimitive.Close
			data-slot="alert-dialog-cancel"
			className={cn(className)}
			render={<Button variant={variant} size={size} />}
			{...props}
		/>
	);
}

export {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogMedia,
	AlertDialogOverlay,
	AlertDialogPortal,
	AlertDialogTitle,
	AlertDialogTrigger,
};
