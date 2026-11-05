import { HardDrivesIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { MenuPath } from "#/components/menu-path.tsx";
import { CONTACT_EMAIL, LICENSE_NAME } from "#/lib/links.ts";

import "./legal.css";

/**
 * Privacy and Terms are one shared shape: a Privacy/Terms toggle, a sticky
 * "on this page" nav, a note box and a run of numbered sections.
 *
 * Both documents describe what this codebase does — the fields it stores, the
 * cookies it sets, the services it calls — as run by Profico on
 * farmer.profi.co. A change to any of those (a new integration, a new cookie,
 * a new retention job) makes one of these paragraphs false: update it here, and
 * bump its `updated` and `version`.
 */
type LegalDocKey = "privacy" | "terms" | "deleteAccount";

type LegalSection = { h: string; body: ReactNode };

type LegalDoc = {
	title: string;
	updated: string;
	version: string;
	note: ReactNode;
	sections: LegalSection[];
};

const ENTITY = "INNOVATIO PROFICIT d.o.o.";
const ADDRESS = "Viška 2, 21000 Split, Croatia";

const Mail = () => <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>;

const PRIVACY: LegalDoc = {
	title: "Privacy",
	updated: "5 November 2026",
	version: "1.1",
	note: (
		<>
			This policy covers farmer.profi.co, the Farmer instance that Profico runs,
			and this website. Farmer is also software anybody can run on their own
			server. On a self-hosted instance, the operator of that instance owns the
			data and is responsible for it, and Profico never receives any of it.
		</>
	),
	sections: [
		{
			h: "Who is responsible",
			body: (
				<>
					<p>
						Farmer is built and run by {ENTITY}, {ADDRESS} ("Profico", "we").
						You can reach us about anything in this policy at <Mail />.
					</p>
					<p>
						Profico is the controller of your account data, of the analytics we
						collect and of anything you send us directly, such as an
						early-access request. The time data inside a workspace belongs to
						the organization that runs that workspace, usually your employer.
						For that data the organization is the controller and Profico
						processes it on the organization's behalf. If you want to see,
						correct or delete the time entries in a workspace, ask the
						organization first; we help them answer you.
					</p>
				</>
			),
		},
		{
			h: "What we collect",
			body: (
				<>
					<p>We collect only what Farmer needs to work:</p>
					<ul>
						<li>
							<strong>Account.</strong> Your name, email address and profile
							picture, taken from the provider you sign in with (Google, GitHub
							or your organization's single sign-on). Farmer refreshes them from
							Google each time you sign in. We never see your password for those
							providers.
						</li>
						<li>
							<strong>Sessions.</strong> For each signed-in device: the IP
							address, the browser's user agent and when the session expires.
							You can see and end every session under{" "}
							<MenuPath steps={["Settings", "Preferences"]} />.
						</li>
						<li>
							<strong>Audit log.</strong> For each change to the workspace's
							shared data, the workspace keeps what was done, who did it, the IP
							address and the browser's user agent. It also keeps every sign-in,
							sign-out and failed sign-in. The administrators of that workspace
							can read this log.
						</li>
						<li>
							<strong>Workspace data.</strong> Clients, projects, tasks, time
							entries and their notes, running timers, working hours, absences,
							and the membership details an administrator enters, such as your
							role, start date, employment type and expected hours.
						</li>
						<li>
							<strong>Uploads.</strong> Only project icons and the organization
							logo, up to 1 MB each.
						</li>
						<li>
							<strong>Assistant conversations.</strong> If your workspace uses
							the assistant, we store your conversations with it, including the
							answers and the data its tools read, until you delete them.
						</li>
						<li>
							<strong>Notifications.</strong> If you turn on push notifications,
							the address your browser's push service gives us and the browser's
							user agent.
						</li>
						<li>
							<strong>Emails to us.</strong> When you write to <Mail />, for
							example to ask for early access, we keep your address and your
							message.
						</li>
					</ul>
					<p>
						We do not collect payment details, and we do not buy or receive data
						about you from data brokers.
					</p>
				</>
			),
		},
		{
			h: "Analytics and cookies",
			body: (
				<>
					<p>
						We use PostHog, hosted in the EU, to understand how Farmer is used
						and to find errors. When you are signed in, PostHog links events to
						your account ID, name and email. It records page views, clicks,
						errors, and product events such as "a time entry was created". Those
						events carry IDs and numbers, not the text of your entries. PostHog
						does not record your screen.
					</p>
					<p>
						For the assistant and the MCP server, PostHog receives the model
						name, token counts, cost, timing and the names of the tools that
						ran. The content of prompts, answers and tool results is replaced
						with its length before it leaves our server.
					</p>
					<p>Farmer sets these cookies:</p>
					<ul>
						<li>
							<code>better-auth.session_token</code>: keeps you signed in. It
							lasts seven days and renews while you use Farmer.
						</li>
						<li>
							Short-lived sign-in cookies, such as <code>oauth_state</code>,
							which protect a sign-in against forgery and expire with it.
						</li>
						<li>
							<code>sidebar_state</code>: remembers whether the sidebar is open,
							for seven days.
						</li>
						<li>
							<code>ph_…_posthog</code>: PostHog's analytics identifier.
						</li>
					</ul>
					<p>
						Your display preferences (theme, fonts, density, motion) stay in
						your browser's local storage and never reach our server.
					</p>
				</>
			),
		},
		{
			h: "Data from integrations",
			body: (
				<>
					<p>
						Every integration is off until you or an administrator of your
						workspace turns it on, and each one reads only what it needs to fill
						in your time:
					</p>
					<ul>
						<li>
							<strong>Google Calendar</strong> (read-only). The title, time,
							location and meeting link of the events on your primary calendar,
							and your own response to each. Farmer never writes to your
							calendar.
						</li>
						<li>
							<strong>GitHub.</strong> A GitHub App, installed by your
							organization on the repositories it chooses, with read access to
							contents and pull requests. Farmer stores the commits and pull
							request reviews it turns into time entries: the commit hash,
							message, author login, time and link, and the pull request's
							number, title and review state. GitHub's sign-in asks for broader
							access; Farmer uses that token only to read your profile and your
							organization's GitHub App installations.
						</li>
						<li>
							<strong>Slack.</strong> Farmer looks up workspace members in Slack
							by email address and sends direct messages: invitations, reminders
							and a summary for administrators.
						</li>
						<li>
							<strong>Harvest import.</strong> A CSV export you upload. Your
							browser reads the file; the server receives the rows. A person in
							the file without an email address gets a generated address and an
							archived account.
						</li>
						<li>
							<strong>Webhooks.</strong> An administrator can send events to a
							URL of the organization's choice. The events can contain a
							member's name, email address and entry notes.
						</li>
					</ul>
				</>
			),
		},
		{
			h: "How we use it",
			body: (
				<>
					<p>We use your data to:</p>
					<ul>
						<li>
							Run Farmer: sign you in, record and total your time, build
							reports, and send the invitations, reminders and notifications you
							or your workspace turned on. The legal basis is our contract with
							you or with your organization.
						</li>
						<li>
							Keep Farmer secure and reliable: rate limits, session management
							and error tracking. The legal basis is our legitimate interest in
							a secure service.
						</li>
						<li>
							Improve Farmer, through the analytics described above. The legal
							basis is our legitimate interest in knowing which parts of the
							product work.
						</li>
						<li>
							Answer you when you write to us, and tell you when hosted Farmer
							is ready if you asked us to. The legal basis is your consent,
							which you can withdraw at any time.
						</li>
					</ul>
					<p>
						We do not sell your data, we do not use it for advertising, and we
						do not use it to train AI models.
					</p>
				</>
			),
		},
		{
			h: "The assistant",
			body: (
				<>
					<p>
						The assistant is optional. A workspace turns it on by adding its own
						OpenRouter API key, and an administrator chooses the model. When you
						use it, Farmer sends OpenRouter your name, email address, role, the
						organization's name, your messages and the results of the tools the
						assistant runs, such as timesheet rows and the names of colleagues.
						OpenRouter passes the request to the company that makes the chosen
						model.
					</p>
					<p>
						That transfer happens under your organization's own account with
						OpenRouter, so OpenRouter's terms and the model provider's terms
						apply to it. Both can process data outside the EU. The assistant's
						answers can be wrong: check them before you rely on them.
					</p>
				</>
			),
		},
		{
			h: "Who we share it with",
			body: (
				<>
					<p>
						We share data only with the service providers that run Farmer for
						us, and only what each one needs:
					</p>
					<ul>
						<li>
							Our hosting provider, which runs the server, the database and file
							storage in the EU.
						</li>
						<li>
							Cloudflare, which carries every request to Farmer and protects it
							from attacks. It sees your IP address and the requests you make.
						</li>
						<li>PostHog, in the EU, for analytics and error tracking.</li>
						<li>Our email provider, to deliver invitations.</li>
						<li>
							Your browser's push service (Google, Mozilla, Apple or Microsoft),
							if you turn on push notifications. It receives the title and text
							of each notification.
						</li>
						<li>
							Google, GitHub, Slack and OpenRouter, only when your workspace
							turns on the matching integration.
						</li>
					</ul>
					<p>
						Your data stays in the EU, except where a provider above works
						outside it. Those transfers rely on the European Commission's
						adequacy decisions or its standard contractual clauses. We disclose
						data to authorities only when the law requires it.
					</p>
				</>
			),
		},
		{
			h: "How long we keep it",
			body: (
				<>
					<ul>
						<li>
							Account and workspace data: while your account and workspace
							exist. When one of them is closed, we delete its data within 30
							days.
						</li>
						<li>
							Sessions: until they expire, seven days after you last used them,
							or until you end them.
						</li>
						<li>Assistant conversations: until you delete them.</li>
						<li>
							Audit log: the administrators of each workspace choose how long it
							keeps the log: 90 days, 1 year, 2 years or 7 years. The default is
							1 year. After that time, Farmer deletes the entries.
						</li>
						<li>
							Webhook events: their contents are cleared after three days, and
							the record of each delivery is deleted after 14 days.
						</li>
						<li>
							Uploaded images that nothing uses any more: deleted after one day.
						</li>
						<li>
							Early-access requests: until we have told you hosted Farmer is
							ready, or until you ask us to forget you.
						</li>
					</ul>
					<p>
						Apart from the audit log, Farmer keeps no log of your requests.
						Error messages go to the server's console, which our hosting
						provider rotates.
					</p>
				</>
			),
		},
		{
			h: "How we protect it",
			body: (
				<p>
					Every connection to Farmer uses TLS. Tokens from Google, GitHub and
					Slack, API keys and other secrets are encrypted before they reach the
					database. Workspaces are separated from each other in every query, and
					sign-in and API requests are rate limited. No system is perfectly
					secure: if we learn of a breach that affects your data, we tell you
					and the supervisory authority as the GDPR requires.
				</p>
			),
		},
		{
			h: "Your rights",
			body: (
				<>
					<p>Under the GDPR you have the right to:</p>
					<ul>
						<li>see the data we hold about you, and get a copy of it;</li>
						<li>have it corrected or deleted;</li>
						<li>restrict how we use it, or object to that use;</li>
						<li>
							receive it in a machine-readable format to take to another
							service;
						</li>
						<li>withdraw a consent you gave, at any time.</li>
					</ul>
					<p>
						To delete your account, follow the steps on{" "}
						<Link to="/delete-account">Delete your account</Link>.
					</p>
					<p>
						Write to <Mail /> and we answer within one month. You can also
						complain to the Croatian Personal Data Protection Agency (AZOP,{" "}
						<a href="https://azop.hr">azop.hr</a>) or to the authority where you
						live.
					</p>
				</>
			),
		},
		{
			h: "Changes to this policy",
			body: (
				<p>
					When Farmer starts to collect something new or to use a new provider,
					we update this page and its date. If a change matters to how we use
					your data, we tell you in Farmer or by email before it applies.
				</p>
			),
		},
	],
};

const TERMS: LegalDoc = {
	title: "Terms",
	updated: "23 September 2026",
	version: "1.0",
	note: (
		<>
			These terms cover farmer.profi.co, the Farmer instance that Profico runs.
			A self-hosted instance is governed by its operator's terms; the software
			itself is licensed under {LICENSE_NAME}.
		</>
	),
	sections: [
		{
			h: "Agreement",
			body: (
				<>
					<p>
						These terms are an agreement between you and {ENTITY}, {ADDRESS}{" "}
						("Profico", "we"). By creating an account on farmer.profi.co or
						using it, you accept them. If you use Farmer for an organization,
						you accept them for that organization too, and you confirm that you
						may do so.
					</p>
					<p>
						Our <Link to="/privacy">privacy policy</Link> explains how we handle
						personal data, and is part of these terms.
					</p>
				</>
			),
		},
		{
			h: "Accounts and workspaces",
			body: (
				<>
					<p>
						You sign in with Google, GitHub or your organization's single
						sign-on, and you are responsible for what happens under your
						account. Tell us at once if you think somebody else has used it.
					</p>
					<p>
						A workspace belongs to the organization that created it. Its owners
						and administrators decide who joins, what role each person has,
						which integrations are on, and when somebody leaves. Removing a
						person from a workspace ends their access to it.
					</p>
					<p>You must be at least 16 years old to use Farmer.</p>
				</>
			),
		},
		{
			h: "Acceptable use",
			body: (
				<>
					<p>You agree not to:</p>
					<ul>
						<li>break the law, or help somebody else break it, with Farmer;</li>
						<li>
							access a workspace, account or data you were not given access to,
							or test Farmer's security without our written permission;
						</li>
						<li>
							overload Farmer, get around its rate limits, or scrape it outside
							the documented API, CLI and MCP server;
						</li>
						<li>upload malware, or content you have no right to share;</li>
						<li>resell access to farmer.profi.co without our agreement.</li>
					</ul>
					<p>
						If you find a security problem, write to <Mail /> and we will work
						with you on it.
					</p>
				</>
			),
		},
		{
			h: "Your content",
			body: (
				<>
					<p>
						The data you and your organization put into Farmer — time entries,
						notes, projects, clients and files — stays yours. You give us only
						the permission we need to store, process and show it to run Farmer
						for you, as the privacy policy describes.
					</p>
					<p>
						You can export reports as CSV or PDF at any time. Because Farmer is
						open source, you can also move your workspace to a server of your
						own; we help you do that on request.
					</p>
				</>
			),
		},
		{
			h: "The software license",
			body: (
				<p>
					Farmer's source code is published under the GNU Affero General Public
					License, version 3 (
					<a href="https://www.gnu.org/licenses/agpl-3.0.html">
						{LICENSE_NAME}
					</a>
					). That license, not these terms, governs what you may do with the
					code: you can use, change and run it yourself, and if you offer a
					changed version to others over a network, you must publish your
					changes under the same license. These terms cover only the service we
					run at farmer.profi.co. The Farmer name and logo are Profico's, and
					the license does not grant any rights in them.
				</p>
			),
		},
		{
			h: "Fees",
			body: (
				<p>
					Farmer on farmer.profi.co costs nothing today. We are preparing a
					hosted Farmer for other organizations; when it has plans and prices,
					we will agree them with your organization before we charge anything.
					We will never start to charge an existing workspace without telling it
					first.
				</p>
			),
		},
		{
			h: "Third-party services",
			body: (
				<p>
					Farmer can connect to Google Calendar, GitHub, Slack and, for the
					assistant, OpenRouter. Each of those services has its own terms, which
					apply between you or your organization and that service. We are not
					responsible for them, and a change on their side can stop an
					integration from working.
				</p>
			),
		},
		{
			h: "Availability",
			body: (
				<>
					<p>
						We work to keep Farmer available and your data safe. We do not
						promise that Farmer will always be available or free of errors: we
						sometimes take it down to maintain it, and we change and remove
						features as the product develops. When a change removes something
						you rely on, we tell you ahead of time where we can.
					</p>
					<p>
						Farmer fills in time for you from your calendar and your code. Check
						what it fills in, and what the assistant tells you: you and your
						organization remain responsible for the timesheets you submit.
					</p>
				</>
			),
		},
		{
			h: "Liability",
			body: (
				<>
					<p>
						As far as the law allows, we provide Farmer as it is, and we are not
						liable for indirect or consequential loss, such as lost profit, lost
						revenue or lost data. Our total liability to you under these terms
						is limited to the fees you paid us in the twelve months before the
						claim, or EUR 100 if you paid nothing.
					</p>
					<p>
						Nothing in these terms limits our liability for damage we cause
						intentionally or through gross negligence, for death or personal
						injury, or any right a consumer has that the law does not allow a
						contract to take away.
					</p>
				</>
			),
		},
		{
			h: "Ending the agreement",
			body: (
				<>
					<p>
						You can stop using Farmer at any time. To close your account or your
						organization's workspace, write to <Mail />; we delete its data as
						the privacy policy describes.
					</p>
					<p>
						We can suspend or close an account or workspace that breaks these
						terms, after we warn you, unless the breach is serious or the law
						requires us to act at once. If we stop running farmer.profi.co, we
						tell you at least 60 days ahead so you can export your data or move
						to your own server.
					</p>
				</>
			),
		},
		{
			h: "Changes to these terms",
			body: (
				<p>
					We may update these terms. We change the date at the top of this page
					each time, and we tell you in Farmer or by email at least 30 days
					before a change that affects your rights takes effect. If you do not
					accept a change, you can stop using Farmer before it applies.
				</p>
			),
		},
		{
			h: "Governing law",
			body: (
				<p>
					Croatian law governs these terms, and the courts in Split, Croatia,
					decide any dispute about them. If you are a consumer, you also keep
					the protection of the law of the country where you live, and you can
					bring a claim there.
				</p>
			),
		},
	],
};

/** The page Google Play links as the app's account deletion page. Play needs
 *  the app and developer name, the steps, and what is kept and for how long. */
const DELETE_ACCOUNT: LegalDoc = {
	title: "Delete your account",
	updated: "5 November 2026",
	version: "1.0",
	note: (
		<>
			This page is for Farmer, the app and the website that {ENTITY} ("Profico")
			runs on farmer.profi.co. If you use Farmer on a self-hosted server, the
			operator of that server holds your account. Ask them to delete it.
		</>
	),
	sections: [
		{
			h: "How to ask",
			body: (
				<ol>
					<li>
						Write to <Mail /> from the email address of your Farmer account.
					</li>
					<li>Use the subject "Delete my account".</li>
					<li>
						If the email address of your account is a different one, write it in
						the message.
					</li>
				</ol>
			),
		},
		{
			h: "What happens next",
			body: (
				<p>
					We reply to confirm that the request comes from you. Then we delete
					your account within 30 days. You do not need the app for any of these
					steps.
				</p>
			),
		},
		{
			h: "What we delete",
			body: (
				<ul>
					<li>Your name, email address and profile picture.</li>
					<li>Your sessions, API tokens and sign-in methods.</li>
					<li>The phones and browsers that get your notifications.</li>
					<li>Your assistant conversations and your own preferences.</li>
				</ul>
			),
		},
		{
			h: "What we keep",
			body: (
				<>
					<p>
						The time data inside a workspace belongs to the organization that
						runs that workspace, usually your employer. Your time entries stay
						in that workspace as the organization's records. To delete them, ask
						the organization first.
					</p>
					<p>
						The audit log of each workspace that you joined keeps the record of
						your changes and sign-ins: your name as it was then, the IP address
						and the browser's user agent. Nobody can change these entries. They
						stay until the retention period of that workspace ends: 90 days, 1
						year, 2 years or 7 years, as its administrators choose. After that
						time, Farmer deletes the entries.
					</p>
				</>
			),
		},
	],
};

const DOCS = {
	privacy: PRIVACY,
	terms: TERMS,
	deleteAccount: DELETE_ACCOUNT,
} satisfies Record<LegalDocKey, LegalDoc>;

export function LegalDocument({ doc }: { doc: LegalDocKey }) {
	const d = DOCS[doc];
	const sections = d.sections.map((s, i) => ({
		n: String(i + 1).padStart(2, "0"),
		...s,
	}));

	return (
		<>
			<section className="fm-container fm-container-md fm-legal-hero">
				<div className="fm-segmented" style={{ alignSelf: "flex-start" }}>
					<Link
						to="/privacy"
						aria-current={doc === "privacy" ? "page" : undefined}
					>
						Privacy
					</Link>
					<Link to="/terms" aria-current={doc === "terms" ? "page" : undefined}>
						Terms
					</Link>
				</div>
				<h1 className="fm-h1">{d.title}</h1>
				<p className="fm-mono fm-faint" style={{ margin: 0, fontSize: 13 }}>
					Last updated {d.updated} · Version {d.version}
				</p>
			</section>
			<section className="fm-container fm-container-md fm-legal-body">
				<nav className="fm-legal-toc fm-sm-hide" aria-label="On this page">
					<span className="fm-legal-toc-label">On this page</span>
					{sections.map((s) => (
						<a href={`#s${s.n}`} key={s.n}>
							<span>{s.n}</span>
							{s.h}
						</a>
					))}
				</nav>
				<article className="fm-legal-article">
					<div className="fm-legal-note">
						<HardDrivesIcon weight="duotone" size={22} />
						<p>{d.note}</p>
					</div>
					{sections.map((s) => (
						<section className="fm-legal-section" id={`s${s.n}`} key={s.n}>
							<h2>
								<span>{s.n}</span>
								{s.h}
							</h2>
							{s.body}
						</section>
					))}
					<div className="fm-legal-questions">
						Questions: <Mail />
					</div>
				</article>
			</section>
		</>
	);
}
