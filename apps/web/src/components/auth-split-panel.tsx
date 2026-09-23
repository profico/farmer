import { MagicWandIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";

import { FarmerMark } from "#/components/farmer-mark.tsx";

// The site tokens and controls (`.fm-site`), then the sign-in frame's own.
import "#/components/site/site.css";
import "#/components/site/auth.css";

/**
 * The frame every sign-in screen sits in: an ink brand column on the left,
 * the content panel on the right, one card on the ground. `/login`,
 * `/no-access`, `/choose-organization`, `/accept-invite/:id` and `/device`
 * all draw it.
 *
 * The brand column is the site's ink surface (`--ink-*` in site.css), dark
 * whatever the page around it is doing. It is the one place the product
 * shows its other face, which is why it can carry a serif line at a size no
 * other screen uses. On a phone it shrinks to the name and the tagline.
 *
 * `kind` picks what the column says: the timesheet (a day, assembled) or the
 * terminal (`farmer login` waiting for this page).
 */
export function AuthSplitPanel({
	kind = "web",
	brand,
	terminalCode,
	children,
}: {
	kind?: "web" | "device";
	/**
	 * Whitelabelling for single-org mode: the one organization's name, and its
	 * logo when it has one, replace the Farmer wordmark, so an invite-only
	 * instance greets people with the company they were invited to. Farmer
	 * then signs the foot of the column. Outside single-org mode this is null
	 * and the column shows Farmer.
	 *
	 * Read live from the organization row (Settings → Organization), not from
	 * env vars — a new logo rebrands the sign-in screens.
	 */
	brand?: { name: string; logo: string | null } | null;
	/** The code on the device screens, shown in the terminal card. */
	terminalCode?: string | null;
	children: ReactNode;
}) {
	return (
		<div className="fm-site fm-auth">
			{/* A hairline, not a shadow. The card is not floating over anything. */}
			<div className="fm-auth-card">
				<aside className="fm-auth-brand">
					{brand ? (
						<div className="fm-auth-org">
							{brand.logo ? (
								<img src={brand.logo} alt="" className="fm-auth-org-logo" />
							) : (
								<span className="fm-auth-org-tile" aria-hidden>
									{brand.name.trim().charAt(0).toUpperCase() || "?"}
								</span>
							)}
							<span className="fm-auth-org-name">{brand.name}</span>
						</div>
					) : (
						<div className="fm-auth-wordmark">
							<FarmerMark size={30} />
							<span className="fm-auth-wordmark-name">Farmer</span>
						</div>
					)}

					<div className="fm-auth-preview" aria-hidden>
						{kind === "device" ? (
							<TerminalCard code={terminalCode ?? null} />
						) : (
							<DayCard />
						)}
					</div>

					<div className="fm-auth-foot">
						{kind === "device" ? (
							<p className="fm-auth-tagline">
								Your timesheet, <em>from the terminal.</em>
							</p>
						) : (
							<p className="fm-auth-tagline">
								Every hour, accounted for — <em>without the friction.</em>
							</p>
						)}
						{brand ? (
							<span className="fm-auth-byline">
								<FarmerMark size={14} />
								Time tracking by Farmer
							</span>
						) : null}
					</div>
				</aside>

				<main className="fm-auth-main">{children}</main>
			</div>
		</div>
	);
}

/** An illustration of one assembled day: what Farmer does, without a word
 *  of marketing. Decorative, so the column hides it from assistive tech. */
const DAY = [
	{ time: "09:00", what: "Daily stand-up", note: null, hours: "0.25h" },
	{ time: "09:15", what: "Auth refactor", note: "9 commits", hours: "3.25h" },
	{ time: "13:00", what: "Acme weekly sync", note: null, hours: "1.00h" },
	{ time: "14:00", what: "PR #214", note: "review", hours: "3.25h" },
] as const;

function DayCard() {
	return (
		<div className="fm-auth-day">
			<div className="fm-auth-day-head">
				<MagicWandIcon size={14} weight="duotone" />
				Wed, Jul 9 · assembled
			</div>
			{DAY.map((row) => (
				<div key={row.time} className="fm-auth-day-row">
					<span className="fm-auth-num fm-auth-time">{row.time}</span>
					<span className="fm-auth-grow">
						{row.what}
						{row.note ? (
							<span className="fm-auth-ink-mut"> · {row.note}</span>
						) : null}
					</span>
					<span className="fm-auth-num">{row.hours}</span>
				</div>
			))}
			<div className="fm-auth-day-row fm-auth-day-rule">
				<span className="fm-auth-grow fm-auth-ink-mut">Typed by hand</span>
				<span className="fm-auth-num fm-auth-ink-mut">0.00h</span>
			</div>
			<div className="fm-auth-day-row">
				<span className="fm-auth-grow">Day total</span>
				<span className="fm-auth-num fm-auth-total">7.75h</span>
			</div>
		</div>
	);
}

function TerminalCard({ code }: { code: string | null }) {
	return (
		<pre className="fm-auth-terminal">
			<span className="fm-auth-ink-mut">$</span> farmer login
			{"\n"}
			<span className="fm-auth-ink-mut">
				Open this page and enter the code:
			</span>
			{"\n"}
			<span className="fm-auth-terminal-code">
				{"  "}
				{code ?? "XXXX-XXXX"}
			</span>
			{"\n"}
			<span className="fm-auth-ink-mut">Waiting for approval…</span>
		</pre>
	);
}
