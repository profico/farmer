import { ArrowUpRightIcon, GitBranchIcon } from "@phosphor-icons/react";
import { createFileRoute } from "@tanstack/react-router";

import { SitePage } from "#/components/site/site-chrome.tsx";

import "#/components/site/about.css";
import { githubLinks, LICENSE_NAME, REPOSITORY } from "#/lib/links.ts";

export const Route = createFileRoute("/about")({
	head: () => ({ meta: [{ title: "About · Farmer" }] }),
	component: About,
});

const OFFICES = [
	{ city: "Split", country: "Croatia" },
	{ city: "Zagreb", country: "Croatia" },
	{ city: "Oslo", country: "Norway" },
	{ city: "Toronto", country: "Canada" },
];

function About() {
	const githubUrl = githubLinks(REPOSITORY).home;

	return (
		<SitePage>
			<section className="fm-container fm-about-hero">
				<h1 className="fm-h1">
					Built by an agency that <em className="fm-em">spends time wisely.</em>
				</h1>
			</section>

			<section className="fm-container">
				<img
					className="fm-about-photo"
					src="/_site/about/team.webp"
					alt="The Profico team"
					width={2048}
					height={1197}
					style={{ aspectRatio: "21 / 9" }}
				/>
			</section>

			<section className="fm-container fm-about-section">
				<h2 className="fm-h3">
					Who <em className="fm-em">Profico</em> is
				</h2>
				<div className="fm-about-body">
					<p>
						Profico is a software company that designs, builds and scales
						digital products: custom software, applied AI, and data and business
						intelligence, for startups and enterprises.
					</p>
					<p>
						More than 70 people work in-house, with 30+ vetted contractors.
						Profico also co-founded Shift, one of the region's first startup
						conferences, and runs Profico Academy, a mentored development and
						design programme.
					</p>
					<ul className="fm-about-offices">
						{OFFICES.map(({ city, country }) => (
							<li key={city}>
								<div>{city}</div>
								<div>{country}</div>
							</li>
						))}
					</ul>
					<a className="fm-about-link" href="https://profi.co">
						profi.co
						<ArrowUpRightIcon weight="regular" size={15} />
					</a>
				</div>
			</section>

			<section className="fm-container fm-about-section">
				<h2 className="fm-h3">
					Why <em className="fm-em">Farmer</em> exists
				</h2>
				<div className="fm-about-body">
					<p>
						Most of a work day is already recorded somewhere: in the calendar,
						in the Git history. Typing it into a timesheet again is busywork.
						Farmer fills the timesheet in, and people review it.
					</p>
				</div>
			</section>

			<section className="fm-container fm-about-section">
				<div className="fm-about-callout" style={{ gridColumn: "1 / -1" }}>
					<div>
						<h2 className="fm-h3">Used every day at Profico</h2>
						<p>
							Profico runs Farmer for its own team. Every feature on this site
							is one we use ourselves.
						</p>
					</div>
				</div>
			</section>

			<section className="fm-container fm-about-section fm-about-gallery">
				<img
					className="fm-about-photo"
					src="/_site/about/office-1.webp"
					alt="The Profico office"
					loading="lazy"
					width={1024}
					height={683}
				/>
				<img
					className="fm-about-photo"
					src="/_site/about/office-2.webp"
					alt="The Profico office"
					loading="lazy"
					width={1024}
					height={683}
				/>
				<div className="fm-about-oss">
					<div className="fm-serif" style={{ fontSize: 26, lineHeight: 1.1 }}>
						It's open source.
					</div>
					<p>{LICENSE_NAME}. Read it, run it, change it.</p>
					<a className="fm-about-link" href={githubUrl}>
						<GitBranchIcon weight="regular" size={15} />
						Source on GitHub
					</a>
				</div>
			</section>
		</SitePage>
	);
}
