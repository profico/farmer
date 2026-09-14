import type { ApiWhoami } from "@farmer/core/api";

import { openBrowser } from "../browser";
import {
	configExists,
	readConfig,
	serverEntryFor,
	writeConfig,
} from "../config";
import {
	formatUserCode,
	pollForToken,
	requestDeviceCode,
} from "../device-flow";
import { UsageError } from "../errors";
import {
	ApiClient,
	assertCliSupported,
	fetchMeta,
	isLocalOrigin,
	normalizeOrigin,
	send,
} from "../http";
import { LOGO_WIDTH, logoLines } from "../logo";
import {
	bold,
	createOutput,
	dim,
	green,
	note,
	type Output,
	print,
	printJson,
	say,
	warn,
} from "../output";
import { askText, pickOne, startProgress } from "../prompts";
import {
	credentialStoreFor,
	currentOrigin,
	openOrg,
	orgPath,
	refreshOrganizations,
	type Session,
	transportFor,
} from "../session";
import { type Command, parseCommandArgs } from "./command";

/** The logo greets a first setup only, and only where it can be read: a
 *  terminal at least as wide as it is. A wrapped logo is noise. */
const showBanner = (out: Output, firstRun: boolean) => {
	if (!firstRun || out.json || !out.stdoutTty) return;
	if ((out.columns ?? 0) >= LOGO_WIDTH) {
		print("");
		for (const line of logoLines()) print(green(out, line));
		print("");
		return;
	}
	print(bold(out, "Farmer"));
};

const LOGIN_USAGE = "farmer login [url]";

export const login: Command = {
	name: "login",
	usage: LOGIN_USAGE,
	summary: "Sign in to a Farmer server through the browser.",
	help: [
		"The server address comes from the argument, then FARMER_URL, then the",
		"last server you used. With none of them, farmer asks for it.",
		"",
		"farmer shows a code and opens the approval page in the browser. Approve",
		"the code only when it is the one this terminal shows.",
	],
	run: async (args, runtime) => {
		const { values, positionals } = parseCommandArgs(args, {}, 1, LOGIN_USAGE);
		const out = createOutput(values.json === true, runtime.env);
		showBanner(out, !(await configExists(runtime.paths)));

		const config = await readConfig(runtime.paths);
		const typed =
			positionals[0] ||
			runtime.env.FARMER_URL ||
			config.lastServer ||
			(out.interactive
				? await askText(
						"Farmer server address",
						undefined,
						"https://farmer.example.com",
					)
				: "");
		if (!typed) {
			throw new UsageError(`Pass the server address.\nUsage: ${LOGIN_USAGE}`);
		}
		const origin = normalizeOrigin(typed);
		if (new URL(origin).protocol === "http:" && !isLocalOrigin(origin)) {
			warn(`${origin} is not https, so the sign-in token travels unencrypted.`);
		}

		const transport = transportFor(runtime, origin);
		assertCliSupported(await fetchMeta(transport), transport);

		const code = await requestDeviceCode(transport);
		const opened = await openBrowser(
			code.verificationUriComplete,
			runtime.platform,
			runtime.env,
		);
		note("");
		note(`  Your code: ${formatUserCode(code.userCode)}`);
		note(
			opened
				? "  The approval page is open in your browser. If it is not, open:"
				: "  Open this page in a browser and approve the code:",
		);
		note(`  ${code.verificationUriComplete}`);
		note("");

		const progress = startProgress(out, "Waiting for approval");
		let token: string;
		try {
			token = await pollForToken(transport, code, () =>
				runtime.now().getTime(),
			);
		} catch (error) {
			progress.fail("The sign-in did not finish.");
			throw error;
		}
		progress.stop("Approved.");

		const store = credentialStoreFor(runtime);
		const location = await store.set(origin, token);
		if (location === "file") {
			warn(
				`No system keyring is available, so the token is stored in ${runtime.paths.credentials} (readable only by you).`,
			);
		}
		config.lastServer = origin;
		const server = serverEntryFor(config, origin);
		await writeConfig(runtime.paths, config);

		const session: Session = {
			runtime,
			out,
			config,
			server,
			api: new ApiClient({
				transport,
				token,
				forgetToken: () => store.delete(origin),
			}),
		};
		const me = await refreshOrganizations(session);
		const slugs = me.organizations.map((org) => org.slug);
		if (values.org !== undefined && !slugs.includes(values.org)) {
			throw new UsageError(
				`You are not a member of "${values.org}". Your organizations: ${slugs.join(", ") || "none"}.`,
			);
		}

		let slug: string | null = null;
		const [firstOrg, ...otherOrgs] = me.organizations;
		if (values.org !== undefined) slug = values.org;
		else if (server.org) slug = server.org;
		else if (firstOrg && otherOrgs.length === 0) slug = firstOrg.slug;
		else if (firstOrg && out.interactive) {
			slug = await pickOne(
				"Which organization do you want to use?",
				me.organizations.map((org) => ({
					value: org.slug,
					label: org.name,
					hint: org.slug,
				})),
			);
		}
		server.org = slug;

		let whoami: ApiWhoami | null = null;
		if (slug) {
			whoami = await session.api.get<ApiWhoami>(orgPath(slug, "/whoami"));
			const entry = server.orgs.find((org) => org.slug === slug);
			if (entry) entry.timeZone = whoami.timezone;
		}
		await writeConfig(runtime.paths, config);

		if (out.json) {
			printJson({
				server: origin,
				user: me.user,
				organization: whoami?.organization ?? null,
				tokenStorage: location,
			});
			return;
		}
		print(
			`Logged in to ${origin} as ${bold(out, me.user.name)} <${me.user.email}>.`,
		);
		if (whoami) {
			print(
				`Organization: ${whoami.organization.name} (${whoami.organization.slug}).`,
			);
			print("");
			print(`Try ${bold(out, "farmer today")}, or log time:`);
			print(`  farmer log 1h30m "What you worked on"`);
		} else if (slugs.length === 0) {
			print(
				"Your account is not a member of any organization yet. Ask an admin to invite you.",
			);
		} else {
			print(
				`Choose an organization with ${bold(out, "farmer org use <slug>")}: ${slugs.join(", ")}.`,
			);
		}
	},
};

const LOGOUT_USAGE = "farmer logout";

export const logout: Command = {
	name: "logout",
	usage: LOGOUT_USAGE,
	summary: "End the session on the server and delete the local token.",
	help: [
		"The local token is deleted even when the server cannot be reached. In",
		"that case, end the session in Preferences → Signed-in devices.",
	],
	run: async (args, runtime) => {
		const { values } = parseCommandArgs(args, {}, 0, LOGOUT_USAGE);
		const out = createOutput(values.json === true, runtime.env);
		const config = await readConfig(runtime.paths);
		const origin = currentOrigin(runtime, config);
		const store = credentialStoreFor(runtime);
		const token = origin ? await store.get(origin) : null;

		if (!origin || !token) {
			if (out.json) printJson({ server: origin, revoked: false });
			else print("You are not logged in.");
			return;
		}

		let revoked = false;
		const fallback = "End the session in Preferences → Signed-in devices.";
		try {
			const response = await send(transportFor(runtime, origin), {
				method: "DELETE",
				path: "/api/v1/session",
				token,
			});
			// A 401 means the server had already ended the session.
			revoked = response.ok || response.status === 401;
			if (!revoked) {
				warn(`${origin} answered ${response.status}. ${fallback}`);
			}
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			warn(`${reason}. ${fallback}`);
		}
		await store.delete(origin);

		if (out.json) printJson({ server: origin, revoked });
		else print(`Logged out of ${origin}.`);
	},
};

const WHOAMI_USAGE = "farmer whoami [--org <slug>]";
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const whoami: Command = {
	name: "whoami",
	usage: WHOAMI_USAGE,
	summary: "Show your account, organization, timezone and working days.",
	help: [],
	run: async (args, runtime) => {
		const { values } = parseCommandArgs(args, {}, 0, WHOAMI_USAGE);
		const out = createOutput(values.json === true, runtime.env);
		const { session, scope } = await openOrg(runtime, out, values.org);
		const who = await session.api.get<ApiWhoami>(scope.path("/whoami"));

		const entry = session.server.orgs.find((org) => org.slug === scope.slug);
		if (entry && entry.timeZone !== who.timezone) {
			entry.timeZone = who.timezone;
			await writeConfig(runtime.paths, session.config);
		}

		if (out.json) {
			printJson(who);
			return;
		}
		const role = who.isAdmin ? "admin" : (who.orgRole ?? "member");
		const days = who.workingDays
			.map(
				(day) =>
					`${DAY_NAMES[day.dayOfWeek] ?? day.dayOfWeek} ${day.startTime}-${day.endTime}`,
			)
			.join(", ");
		say(out, `${bold(out, who.name ?? "(no name)")} <${who.email ?? ""}>`);
		say(
			out,
			`Organization  ${who.organization.name} (${who.organization.slug}), ${role}`,
		);
		say(out, `Server        ${session.api.origin}`);
		say(
			out,
			`Timezone      ${who.timezone} ${dim(out, `(today is ${who.today})`)}`,
		);
		say(out, `Working days  ${days || "none set"}`);
		say(out, `Projects      ${who.projects.length}`);
	},
};
