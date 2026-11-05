// Every function of every service that can change an organization is either
// recorded in the audit log or exempt here with a reason.
//
// The log is only worth reading if it is complete, and it goes incomplete
// silently: a new `archiveAll` that nobody wired up looks exactly like a
// workspace where nobody archived anything. So this file enumerates the
// services at runtime, and a function that appears in neither list fails the
// suite until somebody decides which one it belongs in.
//
// A recorded function is also checked for the call itself, through its source:
// `recordAudit(`, `recordSecurityEvent(`, or the named helper it delegates to.

import { describe, expect, test } from "bun:test";

import { accountService } from "./account.service";
import { apiTokensService } from "./api-tokens.service";
import { assistantService } from "./assistant.service";
import { auditService } from "./audit";
import { clientsService } from "./clients.service";
import { githubService } from "./github.service";
import { harvestImportService } from "./harvest-import.service";
import { holidaysService } from "./holidays.service";
import { hourFundService } from "./hour-fund.service";
import { importClaimsService } from "./import-claims.service";
import { membersService } from "./members.service";
import { mobileDevicesService } from "./mobile-devices.service";
import { orgSettingsService } from "./org-settings.service";
import { organizationService } from "./organization.service";
import { projectsService } from "./projects.service";
import { reminderSettingsService } from "./reminder-settings.service";
import { sessionsService } from "./sessions.service";
import { slackService } from "./slack.service";
import { tasksService } from "./tasks.service";
import { teamLeadsService } from "./team-leads.service";
import { timeEntriesService } from "./time-entries.service";
import { webhooksService } from "./webhooks.service";

/** A recorded function, or the helper it delegates the recording to. */
type Recorded = true | { via: string };

type Coverage = {
	recorded: Record<string, Recorded>;
	/** Function name → why it writes no row. */
	exempt: Record<string, string>;
	/** Functions that change nothing, so need no reason. */
	reads: readonly string[];
};

/** A service object: its keys are the functions it exports. */
type ServiceFunctions = Readonly<Record<string, (...args: never[]) => void>>;

const SERVICES = {
	clientsService: {
		service: clientsService,
		coverage: {
			recorded: { create: true, update: true, archive: true, unarchive: true },
			exempt: {
				ensureInternal:
					"creates the workspace's own Internal client on first use, not a decision",
			},
			reads: ["list", "listAll"],
		},
	},
	projectsService: {
		service: projectsService,
		coverage: {
			recorded: {
				create: true,
				update: true,
				archive: { via: "setProjectStatus" },
				unarchive: { via: "setProjectStatus" },
				assignMember: true,
				removeMember: true,
			},
			exempt: {
				assertProjectMembership: "a guard, writes nothing",
			},
			reads: [
				"list",
				"listMine",
				"get",
				"listMembers",
				"overview",
				"listTasks",
				"listAssignable",
			],
		},
	},
	tasksService: {
		service: tasksService,
		coverage: {
			recorded: { create: true, update: true, archive: true, unarchive: true },
			exempt: {
				setHidden: "a person's own task picker",
				showAll: "a person's own task picker",
				hideAll: "a person's own task picker",
			},
			reads: [
				"listAbsenceTasks",
				"absenceTaskIds",
				"listForProject",
				"recentForProject",
				"hiddenIds",
				"findBySystemKey",
				"listSelectable",
				"listManaged",
			],
		},
	},
	membersService: {
		service: membersService,
		coverage: {
			recorded: {
				setType: true,
				setArchived: true,
				confirmEmail: true,
				setStartDate: true,
			},
			exempt: {
				recordInvitationEmail:
					"delivery state of an invitation; the invitation itself is recorded by the better-auth hook",
			},
			reads: [
				"getRole",
				"resolveUserId",
				"directory",
				"roster",
				"list",
				"typesAsOf",
				"typesForMonth",
				"typeFor",
				"archivedUserIds",
				"archivedAtByUserId",
				"pendingInvitation",
				"invitationEmails",
				"typeHistory",
				"people",
				"profile",
				"listInvitations",
			],
		},
	},
	teamLeadsService: {
		service: teamLeadsService,
		coverage: {
			recorded: { setPeople: true },
			exempt: {
				removeFromAllLists:
					"a side effect of removing a member, which is recorded as member.removed",
			},
			reads: ["listPeople", "countsByLead"],
		},
	},
	hourFundService: {
		service: hourFundService,
		coverage: {
			recorded: { set: true, clear: true, prefillYear: true },
			exempt: {},
			reads: ["get", "getMany", "listForYear", "suggestForMonth"],
		},
	},
	holidaysService: {
		service: holidaysService,
		coverage: {
			recorded: { setHolidayDisabled: true },
			exempt: {},
			reads: [
				"listSupportedCountries",
				"listForYear",
				"listForYearWithStatus",
				"holidaySetForRange",
			],
		},
	},
	organizationService: {
		service: organizationService,
		coverage: {
			recorded: { updateSettings: true },
			exempt: {},
			reads: ["getSettings"],
		},
	},
	orgSettingsService: {
		service: orgSettingsService,
		coverage: {
			recorded: { update: true },
			exempt: {},
			reads: ["get", "getForAdmin"],
		},
	},
	reminderSettingsService: {
		service: reminderSettingsService,
		coverage: {
			recorded: { update: true },
			exempt: {},
			reads: ["get", "getForAdmin", "preview"],
		},
	},
	assistantSettings: {
		service: assistantService.settings,
		coverage: {
			recorded: { set: true, update: true, disconnect: true },
			exempt: {},
			reads: ["get", "listModels"],
		},
	},
	webhooksService: {
		service: webhooksService,
		coverage: {
			recorded: { create: true, update: true, remove: true, rollSecret: true },
			exempt: {
				sendTest: "sends an event, changes no configuration",
				resend: "sends an event again, changes no configuration",
			},
			reads: ["list", "get", "deliveries", "eventPayload", "summary"],
		},
	},
	githubService: {
		service: githubService,
		coverage: {
			recorded: {
				connectInstallation: true,
				disconnectInstallation: true,
				linkRepo: true,
				unlinkRepo: true,
			},
			exempt: {
				forgetInstallation:
					"GitHub told us the app was uninstalled; no person in the workspace decided it",
				forgetRepoList: "drops a cache",
				attachCommits: "a person's own time entry",
				detachCommit: "a person's own time entry",
				attachPullRequests: "a person's own time entry",
				detachPullRequestActivity: "a person's own time entry",
			},
			reads: [
				"connectionStatus",
				"listInstallations",
				"installUrl",
				"listAvailableRepos",
				"listLinkedRepos",
				"projectsForRepository",
				"suggestCommits",
				"listUserCommitsByDay",
				"listUserCommitsForDay",
				"listAttachedCommits",
				"listAttachedCommitsInRange",
				"listAttachedCommitsByIds",
				"listAttachedPullRequestActivityInRange",
				"listAttachedPullRequestActivityByIds",
				"listUserPullRequestActivityByDay",
				"listUserPullRequestActivityForDay",
				"suggestPullRequests",
				"listAttachedPullRequestActivity",
			],
		},
	},
	slackService: {
		service: slackService,
		coverage: {
			recorded: { completeInstall: true, disconnect: true },
			exempt: {
				linkMember: "matches a person to their Slack account, no decision",
				syncIdentities: "matches people to Slack accounts, no decision",
				rejectToken: "Slack refused the token; no person decided it",
				sendDm: "sends a message",
				sendInvitation: "sends a message",
				sendTest: "sends a message",
			},
			reads: [
				"status",
				"installUrl",
				"installationFor",
				"slackIdFor",
				"slackIdsFor",
			],
		},
	},
	harvestImportService: {
		service: harvestImportService,
		coverage: {
			// `start` records the invitations it writes, which better-auth's
			// hook never sees. The import itself is recorded once, at finish.
			recorded: { start: true, finish: true, undo: true },
			exempt: {
				importDays:
					"a step of one import; the import is recorded once, at finish",
				removeDays:
					"a step of one import; the import is recorded once, at finish",
			},
			reads: ["snapshot", "takenEmails", "listRuns"],
		},
	},
	importClaimsService: {
		service: importClaimsService,
		coverage: {
			recorded: { accept: { via: "memberJoined" }, decline: true },
			exempt: {},
			reads: ["pendingFor"],
		},
	},
	timeEntriesService: {
		service: timeEntriesService,
		coverage: {
			recorded: {
				overrideAbsence: { via: "recordAbsenceForPerson" },
				createAbsenceForUser: { via: "recordAbsenceForPerson" },
				removeAbsence: { via: "recordAbsenceForPerson" },
			},
			exempt: {
				syncMeetingsForUser: "an automation engine",
				runAutomationsForUser: "the automation engines",
				create: "a person's own time",
				update: "a person's own time",
				file: "a person's own time",
				fileMany: "a person's own time",
				updateDescription: "a person's own time",
				updateDuration: "a person's own time",
				useCalendarValues: "a person's own time",
				acknowledgeCalendarChange: "a person's own time",
				setOvertime: "a person's own time",
				remove: "a person's own time",
				setWeekCell: "a person's own time",
				copyDay: "a person's own time",
				copyWeek: "a person's own time",
				logAbsenceRange: "a person's own time off",
			},
			reads: [
				"listRange",
				"getOwn",
				"getOwnDetailed",
				"listAbsenceForUser",
				"absenceTotals",
			],
		},
	},
	apiTokensService: {
		service: apiTokensService,
		coverage: {
			recorded: { create: true, revoke: true, revokePresented: true },
			exempt: {
				authenticate:
					"moves last_used_at at most once a minute; a use is not a change",
			},
			reads: ["listMine"],
		},
	},
	sessionsService: {
		service: sessionsService,
		coverage: {
			recorded: { revoke: true },
			exempt: {},
			reads: ["listMine", "currentIdFor"],
		},
	},
	mobileDevicesService: {
		service: mobileDevicesService,
		coverage: {
			recorded: {},
			exempt: {
				register:
					"a person's own phone, like a web push subscription; it changes no workspace, and the sign-in that made its session is recorded",
				update:
					"the app reports its own permission and Live Activity token; no workspace changes",
				remove: "a person's own phone; it changes no workspace",
			},
			reads: [],
		},
	},
	accountService: {
		service: accountService,
		coverage: {
			recorded: { unlinkGoogle: true },
			exempt: {
				unlinkIntegration:
					"removes a GitHub or Google Calendar grant, which is an integration and not a sign-in method (docs/domains/audit-log.md)",
			},
			reads: ["signInMethods"],
		},
	},
	auditService: {
		service: auditService,
		coverage: {
			recorded: { exportCsv: true, setRetention: true },
			exempt: {},
			reads: ["list", "retention"],
		},
	},
} satisfies Record<string, { service: ServiceFunctions; coverage: Coverage }>;

/** Each function's name and source. `String(fn)` is the source text. */
const functionsOf = (service: ServiceFunctions): Map<string, string> =>
	new Map(Object.entries(service).map(([name, fn]) => [name, String(fn)]));

const RECORDS = /\brecord(Audit|SecurityEvent)\(/;

describe("audit coverage", () => {
	for (const [name, { service, coverage }] of Object.entries(SERVICES)) {
		test(`${name}: every function is recorded or exempt`, () => {
			const functions = functionsOf(service);
			const classified = new Set([
				...Object.keys(coverage.recorded),
				...Object.keys(coverage.exempt),
				...coverage.reads,
			]);
			const unclassified = [...functions.keys()].filter(
				(fn) => !classified.has(fn),
			);
			const gone = [...classified].filter((fn) => !functions.has(fn));
			expect({ unclassified, gone }).toEqual({ unclassified: [], gone: [] });
		});

		test(`${name}: every recorded function records`, () => {
			const functions = functionsOf(service);
			const silent = Object.entries(coverage.recorded)
				.filter(([fn, how]) => {
					const source = functions.get(fn) ?? "";
					return how === true
						? !RECORDS.test(source)
						: !source.includes(`${how.via}(`);
				})
				.map(([fn]) => fn);
			expect(silent).toEqual([]);
		});
	}
});
