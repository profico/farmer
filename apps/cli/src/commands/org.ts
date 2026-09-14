import type { ApiWhoami } from "@farmer/core/api";

import { UsageError } from "../errors";
import { createOutput, print, printJson } from "../output";
import { plural, printTable } from "../render";
import { connect, orgPath, refreshOrganizations, saveConfig } from "../session";
import { type Command, parseCommandArgs } from "./command";

const LIST_USAGE = "farmer org list";

export const orgList: Command = {
	name: "org list",
	usage: LIST_USAGE,
	summary: "List your organizations. The default one has a *.",
	help: [],
	run: async (args, runtime) => {
		const { values } = parseCommandArgs(args, {}, 0, LIST_USAGE);
		const out = createOutput(values.json === true, runtime.env);
		const session = await connect(runtime, out);
		const me = await refreshOrganizations(session);
		await saveConfig(session);

		if (out.json) {
			printJson(me.organizations);
			return;
		}
		if (me.organizations.length === 0) {
			print("Your account is not a member of any organization yet.");
			return;
		}
		printTable(out, {
			columns: [{ header: "" }, { header: "Slug" }, { header: "Name" }],
			rows: me.organizations.map((org) => [
				org.slug === session.server.org ? "*" : "",
				org.slug,
				org.name,
			]),
			total: ["", "", plural(me.organizations.length, "organization")],
		});
	},
};

const USE_USAGE = "farmer org use <slug>";

export const orgUse: Command = {
	name: "org use",
	usage: USE_USAGE,
	summary: "Set the organization that commands use by default.",
	help: [],
	run: async (args, runtime) => {
		const { values, positionals } = parseCommandArgs(args, {}, 1, USE_USAGE);
		const out = createOutput(values.json === true, runtime.env);
		const slug = positionals[0] ?? values.org;
		if (!slug) throw new UsageError(`Pass the slug.\nUsage: ${USE_USAGE}`);

		const session = await connect(runtime, out);
		const me = await refreshOrganizations(session);
		const entry = session.server.orgs.find((org) => org.slug === slug);
		if (!entry) {
			throw new UsageError(
				`You are not a member of "${slug}". Your organizations: ${me.organizations.map((org) => org.slug).join(", ") || "none"}.`,
			);
		}
		const who = await session.api.get<ApiWhoami>(orgPath(slug, "/whoami"));
		entry.timeZone = who.timezone;
		session.server.org = slug;
		await saveConfig(session);

		if (out.json) printJson(who.organization);
		else {
			print(
				`Commands now use ${who.organization.name} (${slug}) on ${session.api.origin}.`,
			);
		}
	},
};
