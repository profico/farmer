import { Link } from "@tanstack/react-router";

import { FarmerMark } from "#/components/farmer-mark.tsx";

import { type SiteVisitor, VisitorCta } from "./site-chrome.tsx";

import "./front.css";

/** The one organization a single-organization deployment opens on. */
export type FrontDoorOrg = { slug: string; name: string; logo: string | null };

/**
 * The front page of a single-organization deployment: the organization's
 * name and logo, one line and the way in. No marketing — the people who reach
 * this address already work there, so it is a door, not a pitch.
 */
export function FrontDoor({
	visitor,
	org,
}: {
	visitor: SiteVisitor;
	org: FrontDoorOrg;
}) {
	// An organization always has a name, but one that is only whitespace would
	// draw an empty headline; Farmer's own mark and name stand in for it.
	const name = org.name.trim();
	return (
		<div className="fm-site fd-root">
			<main className="fd-main">
				<OrgMark name={name} logo={org.logo} />
				<div className="fd-title">
					<h1 className="fd-name">{name || "Farmer"}</h1>
					<p className="fm-lede fd-line">
						{visitor.user
							? "Our timesheet."
							: "Our timesheet. Sign in with your work account."}
					</p>
				</div>
				<VisitorCta visitor={visitor} className="fm-btn fd-cta" />
				{visitor.user ? (
					<span className="fp-signed">Signed in as {visitor.user.email}</span>
				) : null}
			</main>
			<footer className="fd-footer">
				{name ? (
					<span className="fd-by">
						<FarmerMark size={13} />
						Time tracking by Farmer
					</span>
				) : null}
				<Link to="/privacy">Privacy</Link>
				<Link to="/terms">Terms</Link>
			</footer>
		</div>
	);
}

function OrgMark({ name, logo }: { name: string; logo: string | null }) {
	if (logo) {
		return (
			<span className="fd-logo">
				<img src={logo} alt={name} />
			</span>
		);
	}
	if (name) {
		return (
			<span className="fd-initial" aria-hidden>
				{[...name][0]?.toUpperCase()}
			</span>
		);
	}
	return <FarmerMark size={64} />;
}
