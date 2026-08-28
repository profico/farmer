// A conversation that renders every piece of assistant UI at once.
//
// `bun run db:seed-assistant-ui [org-slug] [user-email]` — dev only.
//
// Not a test and not a fixture: it is the one place to LOOK at the answer
// renderer, because the alternative is asking a real model to please emit a
// trend chart and a table and a citation in the same turn, which costs money,
// takes a minute, and produces something slightly different every time. Every
// message here is written by hand and inserted straight into the tables, so no
// OpenRouter key is touched and no tokens are spent.
//
// Idempotent by title: re-running replaces the thread rather than stacking
// another copy in the rail, so it is safe to run after every change to
// `answer.tsx`. Delete the thread in the UI and re-run to get it back.
//
// The pending approval at the end is REAL — a `file_time_entries` call left
// suspended for consent, which is the only way to see the diff table without
// assembling a day first. Its entry ids are deliberately ones that do not
// exist, so approving it comes back as a tool error rather than re-filing any
// of your actual time.

import { and, eq } from "drizzle-orm";

import { db } from "./index";
import {
	assistantConversation,
	assistantMessage,
	assistantSettings,
} from "./schema/assistant";
import { member, organization, user } from "./schema/auth";

const TITLE = "UI kitchen sink";

const [slugArg, emailArg] = process.argv.slice(2);

const org = slugArg
	? await db.query.organization.findFirst({
			where: eq(organization.slug, slugArg),
		})
	: await db.query.organization.findFirst();

if (!org) {
	console.error(
		slugArg
			? `No organization found with slug "${slugArg}".`
			: "No organization found. Sign in to the app first.",
	);
	process.exit(1);
}

// The thread belongs to one person — a conversation is per-user by design, so
// seeding it for "whoever" would put it in a rail nobody is looking at.
const owner = emailArg
	? await db.query.user.findFirst({ where: eq(user.email, emailArg) })
	: await db.query.member
			.findFirst({
				where: eq(member.organizationId, org.id),
				with: { user: true },
			})
			.then((row) => row?.user);

if (!owner) {
	console.error(
		emailArg
			? `No user found with email "${emailArg}".`
			: `No members in "${org.slug}".`,
	);
	process.exit(1);
}

const settings = await db.query.assistantSettings.findFirst({
	where: eq(assistantSettings.organizationId, org.id),
});

// Replace rather than append. Messages cascade with the conversation.
await db
	.delete(assistantConversation)
	.where(
		and(
			eq(assistantConversation.organizationId, org.id),
			eq(assistantConversation.userId, owner.id),
			eq(assistantConversation.title, TITLE),
		),
	);

const [conversation] = await db
	.insert(assistantConversation)
	.values({
		organizationId: org.id,
		userId: owner.id,
		title: TITLE,
		// The thread never runs, so the model is a label. Falls back to the org's
		// default when the assistant is connected, so the row looks like a real one.
		model: settings?.defaultModel ?? "seeded/none",
	})
	.returning();

if (!conversation) {
	console.error("Could not create the conversation.");
	process.exit(1);
}

/** Dates near today, so the day citations land on days worth opening. */
const dayKey = (offset: number) => {
	const date = new Date();
	date.setDate(date.getDate() - offset);
	return date.toISOString().slice(0, 10);
};

const turns: {
	role: "user" | "assistant";
	content: string;
}[] = [
	{
		role: "user",
		content: "Show me everything you can render — the whole kitchen sink.",
	},
	{
		role: "assistant",
		content: `# Headings, at one weight

Paragraphs render as paragraphs, with **bold**, *italic*, \`inline code\` and [a link](https://www.beautifului.dev/) that opens in a new tab. A day you can click is written as a citation: [[${dayKey(1)}]], [[${dayKey(2)}]], [[${dayKey(8)}]] — each one lands on that day's timesheet.

## Lists

- A bullet, which wraps onto a second line if it is long enough to need one, so you can see how the marker and the text line up when it does
- A second bullet with \`code\` in it

1. A numbered item
2. A second one

---

## A table

| Project | Task | Hours |
|---|---|---:|
| Harbor App | Development | 12.5 |
| Acme Rebrand | *Meetings* | 3.0 |
| Internal | Planning | 1.5 |
| **Total** | | **17.0** |

## A bar chart

Categories, sorted by the thing being compared.

\`\`\`farmer-chart
{"type":"bar","title":"Hours by project — this month","unit":"h","data":[{"label":"Harbor App","value":52.5},{"label":"Acme Rebrand","value":31},{"label":"Internal","value":12.25},{"label":"Nomad Mobile","value":6}]}
\`\`\`

## A trend chart

Time, left to right.

\`\`\`farmer-chart
{"type":"trend","title":"Logged per day — last two weeks","unit":"h","data":[{"label":"Mon","value":7.5},{"label":"Tue","value":8},{"label":"Wed","value":6.25},{"label":"Thu","value":8},{"label":"Fri","value":4},{"label":"Mon","value":8},{"label":"Tue","value":7.75},{"label":"Wed","value":8.5},{"label":"Thu","value":7},{"label":"Fri","value":5.5}]}
\`\`\`

## A code block

\`\`\`ts
const seconds = hours * 3600;
\`\`\`

## A malformed chart

A directive that doesn't parse falls back to a visible code block rather than vanishing, so the numbers survive the mistake:

\`\`\`farmer-chart
{"type":"bar","data":[{"label":"broken","value":"twelve"}]}
\`\`\`

## Follow-ups

\`\`\`farmer-next
How many hours did I log last week?
What have I not filed to a project yet?
Reconstruct yesterday from my commits
\`\`\``,
	},
	{
		role: "user",
		content: "And the approval card with its checklist?",
	},
	{
		role: "assistant",
		content:
			"Here's one, suspended below. It's a seeded example — the entry it names doesn't exist, so approving it fails harmlessly instead of deleting anything. Un-tick a row to watch the button change, or press Don't to clear it.",
	},
];

let created = 0;
for (const turn of turns) {
	await db.insert(assistantMessage).values({
		organizationId: org.id,
		conversationId: conversation.id,
		role: turn.role,
		content: turn.content,
		// Spaced so `orderBy createdAt` is stable — several inserts inside one
		// millisecond otherwise order arbitrarily and the thread reads scrambled.
		createdAt: new Date(Date.now() + created * 1000),
	});
	created += 1;
}

// The suspended call. `pendingApproval` + one unanswered tool call is exactly
// the state `runTurn` leaves behind, so the card renders from the stored row on
// load — the same path a real approval takes after a reload.
const toolCallId = "seeded-approval-1";
/** The same ids the preview rows carry, so un-ticking one actually narrows the
 *  call the way it would on a real batch. */
const seededEntryIds = [1, 2, 3, 4].map(
	(n) => `00000000-0000-4000-8000-00000000000${n}`,
);
await db.insert(assistantMessage).values({
	organizationId: org.id,
	conversationId: conversation.id,
	role: "assistant",
	content: "",
	toolCalls: [
		{
			id: toolCallId,
			name: "file_time_entries",
			arguments: JSON.stringify({
				timeEntryIds: seededEntryIds,
				projectId: "00000000-0000-4000-8000-0000000000ff",
			}),
		},
	],
	pendingApproval: true,
	approvalSummary: "File 4 entries to Harbor App",
	approvalPreview: {
		columns: ["Date", "Hours", "What"],
		rows: [
			{ id: seededEntryIds[0] ?? "", cells: [dayKey(1), "1.00h", "Standup"] },
			{
				id: seededEntryIds[1] ?? "",
				cells: [dayKey(1), "2.50h", "Auth refactor — commit fill"],
			},
			{
				id: seededEntryIds[2] ?? "",
				cells: [dayKey(2), "0.75h", "Design review"],
			},
			{
				id: seededEntryIds[3] ?? "",
				cells: [dayKey(3), "1.25h", "Sprint planning"],
			},
		],
		selectable: true,
	},
	createdAt: new Date(Date.now() + created * 1000),
});

console.log(
	`Seeded "${TITLE}" for ${owner.email} in ${org.slug}: /${org.slug}/assistant?c=${conversation.id}`,
);
process.exit(0);
