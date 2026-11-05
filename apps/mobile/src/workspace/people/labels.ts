// Constants and small helpers of the People screens. The app never imports
// `@farmer/core`, so the labels of the member types are copies of
// `MEMBER_TYPE_LABELS` there.

export const MEMBER_TYPES = [
	"employee_billable",
	"employee_overhead",
	"student_full_time",
	"student_hourly",
	"contractor_full_time",
	"contractor_hourly",
] as const;

export type MemberType = (typeof MEMBER_TYPES)[number];

export const MEMBER_TYPE_LABELS = {
	employee_billable: "Employee · Billable",
	employee_overhead: "Employee · Overhead",
	student_full_time: "Student · Full-time",
	student_hourly: "Student · Hourly",
	contractor_full_time: "Contractor · Full-time",
	contractor_hourly: "Contractor · Hourly",
} satisfies { [type in MemberType]: string };

export const MEMBER_TYPE_OPTIONS = MEMBER_TYPES.map((value) => ({
	value,
	label: MEMBER_TYPE_LABELS[value],
}));

/** Finds the member type of a value from the server. The set is open, so
 *  a value that the app does not know gives null. */
export const memberTypeOf = (value: string): MemberType | null =>
	MEMBER_TYPES.find((type) => type === value) ?? null;

/** The label of a type. A value that the app does not know shows as it came. */
export const typeLabelOf = (value: string) => {
	const type = memberTypeOf(value);
	return type ? MEMBER_TYPE_LABELS[type] : value;
};

/** Only an hourly person has an explicit monthly figure of expected hours. */
export const isHourlyType = (value: string) =>
	value === "student_hourly" || value === "contractor_hourly";

/** True when every word of the query is in one of the texts, with no regard
 *  to the case. An empty query matches all. */
export const matchesSearch = (query: string, texts: string[]) => {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);
	if (words.length === 0) return true;
	const haystack = texts.join(" ").toLowerCase();
	return words.every((word) => haystack.includes(word));
};

export const ROLE_OPTIONS = [
	{ value: "member", label: "Member" },
	{ value: "admin", label: "Admin" },
] as const;
