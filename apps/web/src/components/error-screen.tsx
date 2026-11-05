import { CheckIcon, CopyIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";

import { FarmerMark } from "#/components/farmer-mark.tsx";
import { useInsideSidebar } from "#/components/ui/sidebar.tsx";

/**
 * The frame of the 500 and 404 screens (`route-error.tsx`,
 * `route-not-found.tsx`): one card in the middle of the content area.
 *
 * Under the workspace layout the sidebar already shows the brand, so the
 * screen adds nothing around the card. Outside it (the root route failed, or
 * the address is outside any workspace) the screen fills the window and puts
 * the brand at the top. An error boundary cannot run a loader, so the brand
 * links to `/` and reads no visitor.
 */
export function ErrorScreen({ children }: { children: ReactNode }) {
	const inside = useInsideSidebar();
	return (
		<div
			className={
				inside
					? "flex min-h-[70svh] flex-1 flex-col p-6"
					: "flex min-h-svh flex-col p-6"
			}
		>
			{!inside && (
				<Link
					to="/"
					className="inline-flex items-center gap-2 self-start font-display text-2xl"
				>
					<FarmerMark size={24} />
					Farmer
				</Link>
			)}
			{/* The workspace layout already has a <main>. */}
			{inside ? (
				<div className="grid flex-1 place-items-center">{children}</div>
			) : (
				<main className="grid flex-1 place-items-center">{children}</main>
			)}
		</div>
	);
}

export function ErrorCard({
	icon,
	title,
	children,
	actions,
	after,
}: {
	icon?: ReactNode;
	title: string;
	children: ReactNode;
	actions?: ReactNode;
	/** Full-width rows under the body: a list of links or the ref line. */
	after?: ReactNode;
}) {
	return (
		<div className="w-full max-w-[440px] overflow-hidden rounded-[10px] border bg-card">
			<div className="flex flex-col gap-1.5 p-7">
				{icon && <div className="mb-3">{icon}</div>}
				<h1 className="text-lg leading-snug font-semibold">{title}</h1>
				{children}
				{actions && (
					<div className="mt-3.5 flex flex-wrap gap-2">{actions}</div>
				)}
			</div>
			{after}
		</div>
	);
}

export function ErrorIcon({
	children,
	tone,
}: {
	children: ReactNode;
	tone: "fault" | "neutral";
}) {
	return (
		<span
			aria-hidden
			className={
				tone === "fault"
					? "grid size-10 place-items-center rounded-[9px] bg-destructive/12 text-destructive"
					: "grid size-10 place-items-center rounded-[9px] bg-muted text-muted-foreground"
			}
		>
			{children}
		</span>
	);
}

/** The correlation ref under a 500, with a button that copies it. */
export function ErrorRef({ value }: { value: string }) {
	const [copied, setCopied] = useState(false);
	const copy = () => {
		// The ref stays on screen, so a refused clipboard loses nothing.
		navigator.clipboard.writeText(`ref ${value}`).then(
			() => {
				setCopied(true);
				setTimeout(() => setCopied(false), 1500);
			},
			() => {},
		);
	};
	return (
		<div className="flex items-center justify-between gap-4 border-t bg-muted px-7 py-2.5">
			<span className="font-mono text-xs text-muted-foreground">
				ref {value}
			</span>
			<button
				type="button"
				onClick={copy}
				className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
			>
				{copied ? (
					<CheckIcon size={13} aria-hidden />
				) : (
					<CopyIcon size={13} aria-hidden />
				)}
				{copied ? "Copied" : "Copy"}
			</button>
		</div>
	);
}
