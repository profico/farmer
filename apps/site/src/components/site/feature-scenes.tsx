import {
	BellRingingIcon,
	CalendarBlankIcon,
	GithubLogoIcon,
	SlackLogoIcon,
	TruckIcon,
	WebhooksLogoIcon,
} from "@phosphor-icons/react";

/*
 * The scene behind each feature card: a small drawing of what the card
 * describes, which plays while the pointer is on the card. Decoration only,
 * so each scene is `aria-hidden`. The motion is in `front.css`.
 */

const delay = (i: number, step: number) => ({
	animationDelay: `${i * step}ms`,
});

/** The month's working days fill in, one by one. */
function HoursScene() {
	return (
		<div className="fp-scene-hours">
			{Array.from({ length: 35 }, (_, i) => (
				<span
					key={i}
					data-off={i % 7 > 4 ? "" : undefined}
					style={delay(i, 35)}
				/>
			))}
		</div>
	);
}

const PEOPLE = ["IP", "MK", "LB", "AN", "OZ"];

/** The team lines up. */
function PeopleScene() {
	return (
		<div className="fp-scene-people">
			{PEOPLE.map((initials, i) => (
				<span key={initials} style={delay(i, 90)}>
					{initials}
				</span>
			))}
			<span className="fp-scene-more" style={delay(5, 90)}>
				+24
			</span>
		</div>
	);
}

/** Three project cards fan out. */
function ProjectsScene() {
	return (
		<div className="fp-scene-projects">
			{["🎨", "⚓", "🌾"].map((icon) => (
				<span key={icon}>{icon}</span>
			))}
		</div>
	);
}

/** The bell rings out, and a reminder slides in. */
function RemindersScene() {
	return (
		<div className="fp-scene-reminders">
			<span className="fp-scene-ripple" />
			<span className="fp-scene-ripple" style={delay(1, 500)} />
			<span className="fp-scene-ripple" style={delay(2, 500)} />
			<div className="fp-scene-toast">
				<BellRingingIcon weight="duotone" size={16} />
				<span>
					<b>Friday is 2.00 short</b>
					Log the rest before you go.
				</span>
			</div>
		</div>
	);
}

/** Data flows from the connected services into Farmer. */
function IntegrationsScene() {
	return (
		<div className="fp-scene-integrations">
			<svg viewBox="0 0 190 70">
				<path d="M22 11 C 90 11, 90 35, 150 35" />
				<path d="M22 35 L 150 35" />
				<path d="M22 59 C 90 59, 90 35, 150 35" />
			</svg>
			<span style={{ top: 0 }}>
				<GithubLogoIcon weight="fill" size={13} />
			</span>
			<span style={{ top: 24 }}>
				<CalendarBlankIcon weight="duotone" size={13} />
			</span>
			<span style={{ top: 48 }}>
				<SlackLogoIcon weight="duotone" size={13} />
			</span>
			<span className="fp-scene-hub" style={{ top: 15 }}>
				<WebhooksLogoIcon weight="duotone" size={20} />
			</span>
		</div>
	);
}

/** A truck brings the Harvest rows over. */
function HarvestScene() {
	return (
		<div className="fp-scene-harvest">
			<div className="fp-scene-truck">
				<span className="fp-scene-crate">CSV</span>
				<TruckIcon weight="duotone" size={44} />
			</div>
			<div className="fp-scene-road" />
		</div>
	);
}

/** The workspace switcher steps through three organizations. */
function WorkspacesScene() {
	return (
		<div className="fp-scene-workspaces">
			<span className="fp-scene-pick" />
			{["Acme", "Harbor", "Profico"].map((name) => (
				<span key={name}>
					<b>{name[0]}</b>
				</span>
			))}
		</div>
	);
}

const AUDIT = [
	["09:12", "sign_in", "Google"],
	["09:30", "time_entry.created", "web"],
	["10:02", "project.updated", "api"],
	["10:45", "member.invited", "web"],
	["11:20", "time_entry.updated", "cli"],
	["13:05", "absence.created", "assistant"],
	["14:31", "webhook.created", "web"],
];

/** The log scrolls past. */
function AuditScene() {
	// Twice, so the scroll can loop without a jump.
	const rows = ["a", "b"].flatMap((copy) =>
		AUDIT.map((row) => [`${copy}-${row[0]}`, ...row]),
	);
	return (
		<div className="fp-scene-audit fm-mono">
			<div>
				{rows.map(([key, time, event, via]) => (
					<span key={key}>
						<i>{time}</i> {event} <i>· {via}</i>
					</span>
				))}
			</div>
		</div>
	);
}

/** A color wheel turns, and the card flips between light and dark. */
function ThemeScene() {
	return (
		<div className="fp-scene-theme">
			<span className="fp-scene-wheel" />
			<span className="fp-scene-dark" />
		</div>
	);
}

const SCENES = {
	hours: HoursScene,
	people: PeopleScene,
	projects: ProjectsScene,
	reminders: RemindersScene,
	integrations: IntegrationsScene,
	harvest: HarvestScene,
	workspaces: WorkspacesScene,
	audit: AuditScene,
	theme: ThemeScene,
};

export type SceneName = keyof typeof SCENES;

export function FeatureScene({ scene }: { scene: SceneName }) {
	const Scene = SCENES[scene];
	return (
		<div className="fp-scene" aria-hidden>
			<Scene />
		</div>
	);
}
