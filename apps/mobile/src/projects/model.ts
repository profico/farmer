/**
 * The pure parts of the project screens: the list in groups by client, the
 * mark of a project, and the body of a create or a change. The rules are
 * the rules of the web app (`routes/$orgSlug/projects/*`).
 */

import type {
	NewProject,
	ProjectDetail,
	ProjectPatch,
} from "@farmer/api-client";

export type ProjectType = NonNullable<ProjectPatch["type"]>;

export const PROJECT_TYPES: {
	value: ProjectType;
	label: string;
	hint: string;
}[] = [
	{
		value: "product_team",
		label: "Product team",
		hint: "A standing team on a retainer. The only type Expected hours apply to.",
	},
	{
		value: "fixed_scope",
		label: "Fixed scope",
		hint: "A bounded piece of work with an hour budget.",
	},
	{ value: "hourly", label: "Hourly", hint: "Billed by the hour as it goes." },
	{
		value: "maintenance",
		label: "Maintenance",
		hint: "Ongoing upkeep. No budget or price configuration in v1.",
	},
	{ value: "internal", label: "Internal", hint: "Our own work. Never billed." },
];

export const asProjectType = (type: string): ProjectType =>
	PROJECT_TYPES.find((item) => item.value === type)?.value ?? "product_team";

export const typeLabel = (type: string) =>
	PROJECT_TYPES.find((item) => item.value === type)?.label ?? type;

/** `[CODE] Name`, as every screen of the web writes a project. */
export const projectTitle = (project: { name: string; code: string | null }) =>
	project.code ? `[${project.code}] ${project.name}` : project.name;

const UPLOAD_PREFIX = "/api/files/";
const UPLOAD_KEY =
	/^orgs\/[A-Za-z0-9_-]{1,64}\/(?:project-icon|org-logo)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|gif|webp|svg)$/;

/** True for the path of an uploaded image, as `isUploadedFile` in the
 *  core decides. Any other text is an emoji. */
export const isUploadedIcon = (icon: string | null) =>
	icon !== null &&
	icon.startsWith(UPLOAD_PREFIX) &&
	UPLOAD_KEY.test(icon.slice(UPLOAD_PREFIX.length));

/** The text of a project's mark: its emoji, or the first letter of its
 *  name. For an upload it is the letter, which `ProjectMark` shows in
 *  place of an image that it cannot draw. */
export const markOf = (icon: string | null, name: string) =>
	icon && !isUploadedIcon(icon)
		? icon
		: name.trim().charAt(0).toUpperCase() || "?";

export type ProjectSort = "month" | "name";

export const PROJECT_SORTS: { value: ProjectSort; label: string }[] = [
	{ value: "month", label: "This month" },
	{ value: "name", label: "Name" },
];

/** True when the project holds the search text in its name, its code or
 *  the name of its client. */
export const projectMatches = (project: ProjectDetail, search: string) => {
	const needle = search.trim().toLowerCase();
	if (!needle) return true;
	return [project.name, project.code ?? "", project.client.name].some((text) =>
		text.toLowerCase().includes(needle),
	);
};

const compareProjects =
	(sort: ProjectSort) => (a: ProjectDetail, b: ProjectDetail) =>
		(sort === "month" ? b.stats.monthSeconds - a.stats.monthSeconds : 0) ||
		a.name.localeCompare(b.name, "hr");

export type ClientGroup = {
	id: string;
	name: string;
	monthSeconds: number;
	projects: ProjectDetail[];
};

/**
 * The active projects in groups by client. By hours, the client with the
 * most hours this month is first, and so is the project in it. By name,
 * the groups and the projects are in alphabetical order.
 */
export const groupByClient = (
	projects: ProjectDetail[],
	sort: ProjectSort,
): ClientGroup[] => {
	const groups = new Map<string, ClientGroup>();
	for (const project of projects) {
		const group = groups.get(project.client.id) ?? {
			id: project.client.id,
			name: project.client.name,
			monthSeconds: 0,
			projects: [],
		};
		group.projects.push(project);
		group.monthSeconds += project.stats.monthSeconds;
		groups.set(project.client.id, group);
	}
	return [...groups.values()]
		.sort(
			(a, b) =>
				(sort === "month" ? b.monthSeconds - a.monthSeconds : 0) ||
				a.name.localeCompare(b.name, "hr"),
		)
		.map((group) => ({
			...group,
			projects: [...group.projects].sort(compareProjects(sort)),
		}));
};

/** The archived projects, in the order of the sort. */
export const sortProjects = (projects: ProjectDetail[], sort: ProjectSort) =>
	[...projects].sort(compareProjects(sort));

/** The fields of the project form, as text. */
export type ProjectForm = {
	name: string;
	code: string;
	clientId: string;
	type: ProjectType;
	icon: string;
	budgetHours: string;
	budgetAmount: string;
	hourlyPrice: string;
};

export const EMPTY_FORM: ProjectForm = {
	name: "",
	code: "",
	clientId: "",
	type: "product_team",
	icon: "",
	budgetHours: "",
	budgetAmount: "",
	hourlyPrice: "",
};

export const NAME_MAX_LENGTH = 120;
export const CODE_MAX_LENGTH = 16;

/** The form of a project that exists. */
export const formOf = (project: ProjectDetail): ProjectForm => ({
	name: project.name,
	code: project.code ?? "",
	clientId: project.client.id,
	type: asProjectType(project.type),
	icon: project.icon ?? "",
	budgetHours:
		project.budgetSeconds !== null ? String(project.budgetSeconds / 3600) : "",
	budgetAmount: project.budgetAmount ?? "",
	hourlyPrice: project.hourlyPrice ?? "",
});

const AMOUNT = /^\d+(\.\d{1,2})?$/;
const HOURS = /^\d+(\.\d+)?$/;

export type FormErrors = { [field in keyof ProjectForm]?: string };

/** The errors of the form, in the words of the web form. Only the fields
 *  of the chosen type count. */
export const validateForm = (form: ProjectForm): FormErrors => {
	const errors: FormErrors = {};
	if (!form.name.trim()) errors.name = "Required";
	if (!form.clientId) errors.clientId = "Required";
	if (form.type === "fixed_scope") {
		const hours = form.budgetHours.trim();
		if (hours) {
			const value = Number(hours);
			if (!HOURS.test(hours)) errors.budgetHours = "Must be an amount";
			else if (!(value > 0 && value <= 100_000)) {
				errors.budgetHours = "Must be 1 to 100,000";
			}
		}
		const amount = form.budgetAmount.trim();
		if (amount && !AMOUNT.test(amount)) {
			errors.budgetAmount = "Must be an amount";
		}
	}
	if (form.type === "hourly") {
		const price = form.hourlyPrice.trim();
		if (price && !AMOUNT.test(price)) errors.hourlyPrice = "Must be an amount";
	}
	return errors;
};

/** The money of the chosen type. The server refuses a budget on a type
 *  that has none, so the fields of the other types are not sent. */
const moneyOf = (form: ProjectForm) => ({
	budgetHours:
		form.type === "fixed_scope" && form.budgetHours.trim()
			? Number(form.budgetHours.trim())
			: undefined,
	budgetAmount:
		form.type === "fixed_scope"
			? form.budgetAmount.trim() || undefined
			: undefined,
	hourlyPrice:
		form.type === "hourly" ? form.hourlyPrice.trim() || undefined : undefined,
});

export const newProjectOf = (form: ProjectForm): NewProject => ({
	name: form.name.trim(),
	code: form.code.trim() || undefined,
	clientId: form.clientId,
	type: form.type,
	icon: form.icon.trim() || null,
	...moneyOf(form),
});

/**
 * Only what changed. A patch with `type` resets the money of the type on
 * the server, so a change of the type, the budget or the price sends the
 * type and its money together.
 */
export const patchOf = (
	before: ProjectForm,
	after: ProjectForm,
): ProjectPatch => {
	const patch: ProjectPatch = {};
	if (after.name.trim() !== before.name) patch.name = after.name.trim();
	if (after.code.trim() !== before.code) patch.code = after.code.trim();
	if (after.clientId !== before.clientId) patch.clientId = after.clientId;
	if (after.icon.trim() !== before.icon) patch.icon = after.icon.trim() || null;
	if (
		after.type !== before.type ||
		after.budgetHours.trim() !== before.budgetHours ||
		after.budgetAmount.trim() !== before.budgetAmount ||
		after.hourlyPrice.trim() !== before.hourlyPrice
	) {
		patch.type = after.type;
		Object.assign(patch, moneyOf(after));
	}
	return patch;
};

export const isEmptyPatch = (patch: ProjectPatch) =>
	Object.keys(patch).length === 0;
