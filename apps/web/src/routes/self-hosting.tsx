import {
	ArrowUpRightIcon,
	CopyIcon,
	CubeIcon,
	DatabaseIcon,
	EnvelopeSimpleIcon,
	GithubLogoIcon,
	GoogleLogoIcon,
	HardDrivesIcon,
	ScalesIcon,
	SlackLogoIcon,
	SparkleIcon,
} from "@phosphor-icons/react";
import { createFileRoute, Link } from "@tanstack/react-router";
import type { ComponentType } from "react";

import { loadSiteVisitor, SitePage } from "#/components/site/site-chrome.tsx";

import "#/components/site/self-hosting.css";
import { githubLinks, LICENSE_NAME } from "#/lib/links.ts";

export const Route = createFileRoute("/self-hosting")({
	loader: loadSiteVisitor,
	head: () => ({ meta: [{ title: "Self-hosting · Farmer" }] }),
	component: Page,
});

type Step = {
	heading: string;
	kind: "text" | "run" | "vars" | "worker";
	body?: string;
};

const STEPS: Step[] = [
	{
		kind: "text",
		heading: "Have a Postgres database",
		body: "Any recent Postgres works: a managed one or a container next to Farmer. It is the only required dependency. S3 storage for uploads is optional and can be added later.",
	},
	{ kind: "run", heading: "Run the image" },
	{ kind: "vars", heading: "The three required variables" },
	{ kind: "worker", heading: "Start the background worker" },
	{
		kind: "text",
		heading: "Open it and set up Farmer",
		body: "The first visit asks for a name, email and password. That account administers the instance. From Settings, add a sign-in provider, connect integrations and invite people.",
	},
];

const VARS = [
	{ name: "DATABASE_URL", desc: "Postgres connection string." },
	{
		name: "BETTER_AUTH_SECRET",
		desc: "A long random string that signs sessions. Keep it secret and stable.",
	},
	{
		name: "BETTER_AUTH_URL",
		desc: "The public address of this instance, with https.",
	},
] as const;

const INTEGRATIONS: Array<{
	Icon: ComponentType<{
		size?: number;
		weight?: "duotone";
		className?: string;
	}>;
	name: string;
	desc: string;
}> = [
	{
		Icon: GoogleLogoIcon,
		name: "Google",
		desc: "Sign-in, and Calendar sync per person.",
	},
	{
		Icon: GithubLogoIcon,
		name: "GitHub App",
		desc: "Commits and pull requests, per organization.",
	},
	{
		Icon: SlackLogoIcon,
		name: "Slack",
		desc: "Reminders, digests and invitations as DMs.",
	},
	{
		Icon: SparkleIcon,
		name: "OpenRouter",
		desc: "Your own key for the assistant.",
	},
	{
		Icon: HardDrivesIcon,
		name: "S3 storage",
		desc: "For uploaded logos and project icons.",
	},
	{
		Icon: EnvelopeSimpleIcon,
		name: "Email",
		desc: "Invitations and notices over SMTP.",
	},
];

function Page() {
	const visitor = Route.useLoaderData();
	const links = githubLinks(visitor.repository);
	const image = `ghcr.io/${visitor.repository.toLowerCase()}:latest`;

	return (
		<SitePage visitor={visitor}>
			<section className="fm-container fm-hosting-hero">
				<h1 className="fm-h1">
					One image, one database, <em className="fm-em">three variables.</em>
				</h1>
				<p className="fm-lede" style={{ maxWidth: 620 }}>
					This page gets Farmer running. The full documentation, with every
					option and upgrade note, lives in the repository.
				</p>
				<div className="fm-hosting-badges">
					<span className="fm-pill">
						<CubeIcon
							weight="duotone"
							size={15}
							className="fm-integration-icon"
						/>
						Docker
					</span>
					<span className="fm-pill">
						<DatabaseIcon
							weight="duotone"
							size={15}
							className="fm-integration-icon"
						/>
						Postgres
					</span>
					<span className="fm-pill">
						<ScalesIcon
							weight="duotone"
							size={15}
							className="fm-integration-icon"
						/>
						{LICENSE_NAME}
					</span>
				</div>
			</section>

			<section className="fm-container fm-steps">
				{STEPS.map((step, i) => (
					<div className="fm-step" key={step.heading}>
						<span className="fm-step-n">{String(i + 1).padStart(2, "0")}</span>
						<div className="fm-step-body">
							<h2 className="fm-step-heading">{step.heading}</h2>
							{step.body ? <p className="fm-muted">{step.body}</p> : null}
							{step.kind === "run" ? (
								<>
									<div className="fm-codeblock">
										<div className="fm-codeblock-bar">
											<span className="fm-mono">shell</span>
											<span
												style={{
													marginLeft: "auto",
													display: "inline-flex",
													alignItems: "center",
													gap: 5,
												}}
											>
												<CopyIcon weight="duotone" size={14} />
												Copy
											</span>
										</div>
										<pre>
											{"docker run -d --name farmer -p 3000:3000 \\\n  -e "}
											<span className="fm-var">DATABASE_URL</span>
											{"=postgres://farmer:…@db:5432/farmer \\\n  -e "}
											<span className="fm-var">BETTER_AUTH_SECRET</span>
											{"=$(openssl rand -base64 32) \\\n  -e "}
											<span className="fm-var">BETTER_AUTH_URL</span>
											{"=https://time.example.com \\\n  "}
											{image}
										</pre>
									</div>
									<p className="fm-faint" style={{ margin: 0, fontSize: 14 }}>
										<code className="fm-code">
											{visitor.repository.toLowerCase()}
										</code>{" "}
										is the repository this instance was built from. Migrations
										run on start.
									</p>
								</>
							) : null}
							{step.kind === "vars" ? (
								<div className="fm-var-table">
									{VARS.map((v) => (
										<div className="fm-var-row" key={v.name}>
											<code>{v.name}</code>
											<span>{v.desc}</span>
										</div>
									))}
								</div>
							) : null}
							{step.kind === "worker" ? (
								<>
									<p className="fm-muted">
										The worker runs the scheduled jobs: calendar and GitHub
										sync, recurring blocks, Slack reminders, the month-end
										reminder, the admin digest and web push. It runs in-process
										on the web host by default; a single instance is enough.
										Without it — or if every job is disabled — the app works,
										but nothing fills itself in.
									</p>
									<a className="fm-step-link" href={links.deployment}>
										Worker setup on GitHub
										<ArrowUpRightIcon weight="regular" size={14} />
									</a>
								</>
							) : null}
						</div>
					</div>
				))}
			</section>

			<section className="fm-container fm-hosting-integrations">
				<div className="fm-integrations-head">
					<h2 className="fm-h3">Optional integrations</h2>
					<p className="fm-muted">
						Most of these are set in the app by an administrator, not in the
						environment.
					</p>
				</div>
				<div className="fm-integration-grid">
					{INTEGRATIONS.map(({ Icon, name, desc }) => (
						<div className="fm-integration" key={name}>
							<Icon
								weight="duotone"
								size={22}
								className="fm-integration-icon"
							/>
							<div>
								<div className="fm-integration-name">{name}</div>
								<div className="fm-integration-desc">{desc}</div>
							</div>
						</div>
					))}
				</div>
				<p className="fm-muted" style={{ margin: "16px 0 0", fontSize: 14 }}>
					Also: any OpenID Connect provider for sign-in, single-organization
					mode, and switches to turn off the assistant, MCP or CLI per
					deployment.
				</p>
			</section>

			<section className="fm-container fm-hosting-docs">
				<div className="fm-docs-card">
					<div className="fm-docs-title">Full documentation</div>
					<a className="fm-docs-link" href={links.docs}>
						Installation guide
						<ArrowUpRightIcon weight="regular" size={15} />
					</a>
					<a className="fm-docs-link" href={links.deployment}>
						Environment reference
						<ArrowUpRightIcon weight="regular" size={15} />
					</a>
					<a className="fm-docs-link" href={links.compose}>
						Docker Compose example
						<ArrowUpRightIcon weight="regular" size={15} />
					</a>
					<a className="fm-docs-link" href={links.home}>
						Repository on GitHub
						<ArrowUpRightIcon weight="regular" size={15} />
					</a>
				</div>
				<p className="fm-muted" style={{ margin: "24px 0 0", fontSize: 15 }}>
					Rather not run it yourself?{" "}
					<Link to="/early-access">Get early access to hosted Farmer</Link>.
				</p>
			</section>
		</SitePage>
	);
}
