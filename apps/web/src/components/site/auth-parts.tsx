import type { Icon } from "@phosphor-icons/react";
import type { ReactNode } from "react";

import { getInitials } from "#/lib/utils.ts";

/**
 * The pieces the sign-in screens share inside `AuthSplitPanel`'s content
 * panel. The styles are in `auth.css`, which the panel imports.
 */

/** The title block: an optional icon tile, the serif title, the lede. */
export function AuthHead({
	icon: IconComponent,
	tone = "accent",
	size,
	title,
	back,
	children,
}: {
	/** A way back above the title, such as "All sign-in options". */
	back?: ReactNode;
	icon?: Icon;
	tone?: "accent" | "warn" | "muted";
	size?: "lg";
	title: ReactNode;
	children?: ReactNode;
}) {
	return (
		<div
			className={
				IconComponent ? "fm-auth-head fm-auth-head-icon" : "fm-auth-head"
			}
		>
			{back}
			{IconComponent ? (
				<span className="fm-auth-icon" data-tone={tone} data-size={size}>
					<IconComponent
						size={size === "lg" ? 24 : 22}
						weight="duotone"
						aria-hidden
					/>
				</span>
			) : null}
			<h1 className="fm-auth-title">{title}</h1>
			{children ? <p className="fm-auth-lede">{children}</p> : null}
		</div>
	);
}

/** An organization's logo, or its initials on the accent. */
export function OrgMark({
	name,
	logo,
	size,
}: {
	name: string;
	logo?: string | null;
	size?: "md" | "lg";
}) {
	return logo ? (
		<img src={logo} alt="" className="fm-auth-mark" data-size={size} />
	) : (
		<span className="fm-auth-mark" data-size={size} aria-hidden>
			{getInitials(name).charAt(0) || "?"}
		</span>
	);
}

/** A form or action error, announced. */
export function AuthError({ children }: { children: ReactNode }) {
	return (
		<p className="fm-auth-error" role="alert">
			{children}
		</p>
	);
}
