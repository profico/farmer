import {
	ArrowRightIcon,
	CodeIcon,
	EnvelopeSimpleIcon,
	ExportIcon,
} from "@phosphor-icons/react";
import { createFileRoute, Link } from "@tanstack/react-router";

import { SitePage } from "#/components/site/site-chrome.tsx";

import "#/components/site/early-access.css";
import { CONTACT_EMAIL, EARLY_ACCESS_FORM_URL } from "#/lib/links.ts";

export const Route = createFileRoute("/early-access")({
	head: () => ({ meta: [{ title: "Early access · Farmer" }] }),
	component: Page,
});

const POINTS = [
	{
		Icon: CodeIcon,
		text: "The same AGPLv3 code you can self-host.",
	},
	{
		Icon: ExportIcon,
		text: "Your data stays yours. Move to your own server when you like.",
	},
	{
		Icon: EnvelopeSimpleIcon,
		text: "One email when there is something to try. Nothing else.",
	},
];

// When the form is not live yet, the CTA is a mailto with a fixed subject,
// so the button never dead-ends even before EARLY_ACCESS_FORM_URL exists.
const ctaHref =
	EARLY_ACCESS_FORM_URL ||
	`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("Early access to hosted Farmer")}`;

function Page() {
	return (
		<SitePage>
			<section className="fm-container fm-early-hero">
				<div className="fm-early-copy">
					<h1 className="fm-h1">
						The same Farmer, <em className="fm-em">without the server.</em>
					</h1>
					<p className="fm-lede" style={{ maxWidth: 480 }}>
						Profico is preparing a hosted Farmer. We would run the server, the
						database and the updates. There are no plans or prices yet, and we
						won't pretend otherwise.
					</p>
					<div className="fm-early-points">
						{POINTS.map(({ Icon, text }) => (
							<div className="fm-early-point" key={text}>
								<Icon weight="duotone" size={20} />
								<span>{text}</span>
							</div>
						))}
					</div>
					<p className="fm-muted" style={{ margin: 0, fontSize: 14.5 }}>
						Can't wait? <Link to="/self-hosting">Self-host it today</Link>, or{" "}
						<a href={`mailto:${CONTACT_EMAIL}`}>talk to us</a>.
					</p>
				</div>

				<div className="fm-frame">
					<div className="fm-island fm-early-cta">
						<span className="fm-early-cta-icon">
							<EnvelopeSimpleIcon weight="duotone" size={24} />
						</span>
						<div className="fm-early-cta-title">Join the list</div>
						<p className="fm-early-cta-body">
							Tell us you're interested and we'll write to you the moment hosted
							Farmer is ready to try. Nothing else, and no plans yet to sign up
							for.
						</p>
						<a
							className="fm-btn fm-btn-block"
							href={ctaHref}
							target="_blank"
							rel="noreferrer"
						>
							Get early access
							<ArrowRightIcon weight="regular" size={16} />
						</a>
						<p className="fm-faint" style={{ margin: 0, fontSize: 12.5 }}>
							We use this only to contact you about hosted Farmer. See{" "}
							<Link to="/privacy">Privacy</Link>.
						</p>
					</div>
				</div>
			</section>
		</SitePage>
	);
}
