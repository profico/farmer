import type {
	AuditExportRange,
	AuditRetentionChange,
	ClientPatch,
	HourFundEntry,
	HourFundMonthRef,
	NewClient,
	NewInvitation,
	NewTask,
	NewWebhookEndpoint,
	OrganizationPatch,
	OrgPolicyPatch,
	PersonRole,
	PersonStartDate,
	PersonType,
	ReminderSettingsPatch,
	SlackTestMessage,
	TaskPatch,
	WebhookEndpointPatch,
} from "@farmer/api-client";
import {
	type QueryClient,
	useInfiniteQuery,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";

import {
	afterClientChange,
	afterOrganizationChange,
	afterPeopleChange,
	afterSlackDisconnect,
	afterTaskChange,
} from "./invalidation";
import { scope, useWorkspace, type Workspace } from "./queries";

// The queries and the changes of the workspace administration screens
// (`app/workspace/*`). Each key starts with `scope(w)`, so two workspaces
// never share an entry. A change invalidates the keys that show its result,
// and also the member screens that read the same rows (the task list of the
// time screen, the projects with their clients, `whoami`).

const MINUTE = 60_000;

const key = (w: Workspace, ...parts: (string | number | undefined)[]) =>
	[...scope(w), "admin", ...parts] as const;

const invalidate = (
	queryClient: QueryClient,
	w: Workspace,
	...parts: string[][]
) =>
	Promise.all(
		parts.map((part) =>
			queryClient.invalidateQueries({ queryKey: [...scope(w), ...part] }),
		),
	);

// People and invitations.

export const usePeople = () => {
	const w = useWorkspace();
	return useQuery({
		queryKey: key(w, "people"),
		queryFn: () => w.client.listPeople(w.slug),
		staleTime: MINUTE,
	});
};

export const usePerson = (userId: string) => {
	const w = useWorkspace();
	return useQuery({
		queryKey: key(w, "people", userId),
		queryFn: () => w.client.getPerson(w.slug, userId),
		staleTime: MINUTE,
	});
};

export const useTeamLeadPeople = (userId: string) => {
	const w = useWorkspace();
	return useQuery({
		queryKey: key(w, "people", userId, "team"),
		queryFn: () => w.client.listTeamLeadPeople(w.slug, userId),
		staleTime: MINUTE,
	});
};

export const useInvitations = () => {
	const w = useWorkspace();
	return useQuery({
		queryKey: key(w, "invitations"),
		queryFn: () => w.client.listInvitations(w.slug),
		staleTime: MINUTE,
	});
};

/** A change to a person changes the list, the profile, the reports that
 *  count them and the capabilities of `whoami`: the whole workspace. */
const usePeopleChange = <Vars, Result>(
	mutationFn: (w: Workspace, vars: Vars) => Promise<Result>,
) => {
	const w = useWorkspace();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (vars: Vars) => mutationFn(w, vars),
		onSuccess: () => afterPeopleChange(queryClient, scope(w)),
	});
};

export const useSetPersonRole = () =>
	usePeopleChange((w, vars: { userId: string; body: PersonRole }) =>
		w.client.setPersonRole(w.slug, vars.userId, vars.body),
	);

export const useSetPersonType = () =>
	usePeopleChange((w, vars: { userId: string; body: PersonType }) =>
		w.client.setPersonType(w.slug, vars.userId, vars.body),
	);

export const useSetPersonStartDate = () =>
	usePeopleChange((w, vars: { userId: string; body: PersonStartDate }) =>
		w.client.setPersonStartDate(w.slug, vars.userId, vars.body),
	);

export const useArchivePerson = () =>
	usePeopleChange((w, vars: { userId: string; archived: boolean }) =>
		vars.archived
			? w.client.archivePerson(w.slug, vars.userId)
			: w.client.restorePerson(w.slug, vars.userId),
	);

export const useConfirmPersonEmail = () =>
	usePeopleChange((w, userId: string) =>
		w.client.confirmPersonEmail(w.slug, userId),
	);

export const useRemovePerson = () =>
	usePeopleChange((w, userId: string) => w.client.removePerson(w.slug, userId));

export const useSetTeamLeadPeople = () =>
	usePeopleChange((w, vars: { userId: string; personUserIds: string[] }) =>
		w.client.setTeamLeadPeople(w.slug, vars.userId, {
			personUserIds: vars.personUserIds,
		}),
	);

export const useInvite = () =>
	usePeopleChange((w, body: NewInvitation) => w.client.invite(w.slug, body));

export const useResendInvitation = () =>
	usePeopleChange((w, id: string) => w.client.resendInvitation(w.slug, id));

export const useCancelInvitation = () =>
	usePeopleChange((w, id: string) => w.client.cancelInvitation(w.slug, id));

// Clients.

export const useClients = () => {
	const w = useWorkspace();
	return useQuery({
		queryKey: key(w, "clients"),
		queryFn: () => w.client.listClients(w.slug, { includeArchived: "true" }),
		staleTime: MINUTE,
	});
};

const useClientChange = <Vars, Result>(
	mutationFn: (w: Workspace, vars: Vars) => Promise<Result>,
) => {
	const w = useWorkspace();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (vars: Vars) => mutationFn(w, vars),
		onSuccess: () => afterClientChange(queryClient, scope(w)),
	});
};

export const useCreateClient = () =>
	useClientChange((w, body: NewClient) => w.client.createClient(w.slug, body));

export const useRenameClient = () =>
	useClientChange((w, vars: { id: string; body: ClientPatch }) =>
		w.client.updateClient(w.slug, vars.id, vars.body),
	);

export const useArchiveClient = () =>
	useClientChange((w, vars: { id: string; archived: boolean }) =>
		vars.archived
			? w.client.archiveClient(w.slug, vars.id)
			: w.client.restoreClient(w.slug, vars.id),
	);

// Tasks.

export const useManagedTasks = () => {
	const w = useWorkspace();
	return useQuery({
		queryKey: key(w, "tasks"),
		queryFn: () => w.client.listManagedTasks(w.slug),
		staleTime: MINUTE,
	});
};

const useTaskChange = <Vars, Result>(
	mutationFn: (w: Workspace, vars: Vars) => Promise<Result>,
) => {
	const w = useWorkspace();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (vars: Vars) => mutationFn(w, vars),
		onSuccess: () => afterTaskChange(queryClient, scope(w)),
	});
};

export const useCreateTask = () =>
	useTaskChange((w, body: NewTask) => w.client.createTask(w.slug, body));

export const useUpdateTask = () =>
	useTaskChange((w, vars: { id: string; body: TaskPatch }) =>
		w.client.updateTask(w.slug, vars.id, vars.body),
	);

export const useArchiveTask = () =>
	useTaskChange((w, vars: { id: string; archived: boolean }) =>
		vars.archived
			? w.client.archiveTask(w.slug, vars.id)
			: w.client.restoreTask(w.slug, vars.id),
	);

// The hour fund.

export const useHourFund = (year: number) => {
	const w = useWorkspace();
	return useQuery({
		queryKey: key(w, "hour-fund", year),
		queryFn: () => w.client.listHourFund(w.slug, { year }),
		staleTime: MINUTE,
	});
};

export const useHourFundSuggestion = (year: number, month: number) => {
	const w = useWorkspace();
	return useQuery({
		queryKey: key(w, "hour-fund", year, "suggestion", month),
		queryFn: () => w.client.suggestHourFund(w.slug, { year, month }),
		staleTime: 5 * MINUTE,
	});
};

/** Each change answers the months of the year, which replace the cache. */
const useHourFundChange = <Vars extends { year: number }>(
	mutationFn: (
		w: Workspace,
		vars: Vars,
	) => ReturnType<Workspace["client"]["listHourFund"]>,
) => {
	const w = useWorkspace();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (vars: Vars) => mutationFn(w, vars),
		onSuccess: async (months, vars) => {
			queryClient.setQueryData(key(w, "hour-fund", vars.year), months);
			// The fund is the Expected figure of the reports.
			await invalidate(queryClient, w, ["tracking"], ["reports"]);
		},
	});
};

export const useSetHourFund = () =>
	useHourFundChange((w, body: HourFundEntry) =>
		w.client.setHourFund(w.slug, body),
	);

export const useClearHourFund = () =>
	useHourFundChange((w, body: HourFundMonthRef) =>
		w.client.clearHourFund(w.slug, body),
	);

export const usePrefillHourFund = () =>
	useHourFundChange((w, body: { year: number }) =>
		w.client.prefillHourFund(w.slug, body),
	);

// The organization.

export const useOrganization = () => {
	const w = useWorkspace();
	return useQuery({
		queryKey: key(w, "organization"),
		queryFn: () => w.client.getOrganization(w.slug),
		staleTime: 5 * MINUTE,
	});
};

export const useUpdateOrganization = () => {
	const w = useWorkspace();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (body: OrganizationPatch) =>
			w.client.updateOrganization(w.slug, body),
		onSuccess: async (settings) => {
			queryClient.setQueryData(key(w, "organization"), settings);
			await afterOrganizationChange(queryClient, scope(w), [
				"farmer",
				w.origin,
				"me",
			]);
		},
	});
};

/** The tracking tolerance and the automation lock. Admin only. */
export const useOrgPolicy = () => {
	const w = useWorkspace();
	return useQuery({
		queryKey: key(w, "organization", "policy"),
		queryFn: () => w.client.getOrgPolicy(w.slug),
		staleTime: 5 * MINUTE,
	});
};

/** The tolerance decides who is behind on the Tracking report, so a change
 *  reads the tracking and the reports again. */
export const useUpdateOrgPolicy = () => {
	const w = useWorkspace();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (body: OrgPolicyPatch) =>
			w.client.updateOrgPolicy(w.slug, body),
		onSuccess: async (policy) => {
			queryClient.setQueryData(key(w, "organization", "policy"), policy);
			await invalidate(queryClient, w, ["tracking"], ["reports"]);
		},
	});
};

// Reminders.

export const useReminderSettings = () => {
	const w = useWorkspace();
	return useQuery({
		queryKey: key(w, "reminders"),
		queryFn: () => w.client.getReminderSettings(w.slug),
		staleTime: MINUTE,
	});
};

export const useUpdateReminderSettings = () => {
	const w = useWorkspace();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (body: ReminderSettingsPatch) =>
			w.client.updateReminderSettings(w.slug, body),
		onSuccess: async (settings) => {
			queryClient.setQueryData(key(w, "reminders"), settings);
			await invalidate(queryClient, w, ["admin", "reminders", "preview"]);
		},
	});
};

export type ReminderKind =
	| "log-reminder"
	| "compliance-nudge"
	| "month-end"
	| "admin-digest";

export const useReminderPreview = (kind: ReminderKind, date: string) => {
	const w = useWorkspace();
	return useQuery({
		queryKey: key(w, "reminders", "preview", kind, date),
		queryFn: () => w.client.previewReminder(w.slug, { kind, date }),
		staleTime: MINUTE,
	});
};

// Workspace integrations.

export const useGithubWorkspace = () => {
	const w = useWorkspace();
	return useQuery({
		queryKey: key(w, "github"),
		queryFn: () => w.client.getGithubWorkspace(w.slug),
		staleTime: MINUTE,
	});
};

/** The install page is a one-time address, so it is asked for on a press
 *  and never cached. */
export const useGithubInstallUrl = () => {
	const w = useWorkspace();
	return useMutation({
		mutationFn: () => w.client.getGithubInstallUrl(w.slug),
	});
};

export const useDisconnectGithub = () => {
	const w = useWorkspace();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (vars: { id: string; uninstall: boolean }) =>
			w.client.disconnectGithubInstallation(w.slug, vars.id, {
				uninstall: vars.uninstall,
			}),
		onSuccess: () => invalidate(queryClient, w, ["admin", "github"]),
	});
};

export const useSlackStatus = () => {
	const w = useWorkspace();
	return useQuery({
		queryKey: key(w, "slack"),
		queryFn: () => w.client.getSlackStatus(w.slug),
		staleTime: MINUTE,
	});
};

export const useSlackInstallUrl = () => {
	const w = useWorkspace();
	return useMutation({
		mutationFn: () => w.client.getSlackInstallUrl(w.slug),
	});
};

export const useDisconnectSlack = () => {
	const w = useWorkspace();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: () => w.client.disconnectSlack(w.slug),
		onSuccess: async (status) => {
			queryClient.setQueryData(key(w, "slack"), status);
			await afterSlackDisconnect(queryClient, scope(w));
		},
	});
};

export const useMatchSlackPeople = () => {
	const w = useWorkspace();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: () => w.client.matchSlackPeople(w.slug),
		onSuccess: () => invalidate(queryClient, w, ["admin", "slack"]),
	});
};

export const useSendSlackTest = () => {
	const w = useWorkspace();
	return useMutation({
		mutationFn: (body: SlackTestMessage) =>
			w.client.sendSlackTest(w.slug, body),
	});
};

// Webhooks. A signing secret is only in the answer of a create or a roll.
// It never goes into the cache: the screen keeps it in its own state until
// the person closes it.

export const useWebhookEndpoints = () => {
	const w = useWorkspace();
	return useQuery({
		queryKey: key(w, "webhooks"),
		queryFn: () => w.client.listWebhookEndpoints(w.slug),
		staleTime: MINUTE,
	});
};

export const useWebhookEndpoint = (id: string) => {
	const w = useWorkspace();
	return useQuery({
		queryKey: key(w, "webhooks", id),
		queryFn: () => w.client.getWebhookEndpoint(w.slug, id),
		staleTime: MINUTE,
	});
};

export const useWebhookDeliveries = (id: string) => {
	const w = useWorkspace();
	return useQuery({
		queryKey: key(w, "webhooks", id, "deliveries"),
		queryFn: () => w.client.listWebhookDeliveries(w.slug, id, { limit: 50 }),
		staleTime: 15_000,
	});
};

const useWebhookChange = <Vars, Result>(
	mutationFn: (w: Workspace, vars: Vars) => Promise<Result>,
) => {
	const w = useWorkspace();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (vars: Vars) => mutationFn(w, vars),
		onSuccess: () => invalidate(queryClient, w, ["admin", "webhooks"]),
	});
};

export const useCreateWebhookEndpoint = () =>
	useWebhookChange((w, body: NewWebhookEndpoint) =>
		w.client.createWebhookEndpoint(w.slug, body),
	);

export const useUpdateWebhookEndpoint = () =>
	useWebhookChange((w, vars: { id: string; body: WebhookEndpointPatch }) =>
		w.client.updateWebhookEndpoint(w.slug, vars.id, vars.body),
	);

export const useDeleteWebhookEndpoint = () =>
	useWebhookChange((w, id: string) =>
		w.client.deleteWebhookEndpoint(w.slug, id),
	);

export const useRollWebhookSecret = () =>
	useWebhookChange((w, id: string) => w.client.rollWebhookSecret(w.slug, id));

export const useSendWebhookTest = () =>
	useWebhookChange((w, id: string) => w.client.sendWebhookTest(w.slug, id));

export const useResendWebhookDelivery = () =>
	useWebhookChange((w, deliveryId: string) =>
		w.client.resendWebhookDelivery(w.slug, deliveryId),
	);

// The audit log.

export type AuditFilters = {
	category?: AuditExportRange["category"];
	kind?: AuditExportRange["kind"];
	userId?: string;
	/** A day, yyyy-MM-dd. */
	from?: string;
	/** A day, yyyy-MM-dd. */
	to?: string;
};

/** The log, newest first, one page at a time. `nextCursor` is null on the
 *  last page. */
export const useAuditEvents = (filters: AuditFilters) => {
	const w = useWorkspace();
	return useInfiniteQuery({
		queryKey: key(
			w,
			"audit",
			filters.category,
			filters.kind,
			filters.userId,
			filters.from,
			filters.to,
		),
		// The first page has no cursor. An empty string stands for it, because
		// the query keeps one type for every page parameter.
		queryFn: ({ pageParam }) =>
			w.client.listAuditEvents(w.slug, {
				...filters,
				cursor: pageParam === "" ? undefined : pageParam,
			}),
		initialPageParam: "",
		getNextPageParam: (page) => page.nextCursor ?? undefined,
		staleTime: MINUTE,
	});
};

/** The export is a write: the server records it in the log. */
export const useExportAudit = () => {
	const w = useWorkspace();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (body: AuditExportRange) =>
			w.client.exportAuditEvents(w.slug, body),
		onSuccess: () => invalidate(queryClient, w, ["admin", "audit"]),
	});
};

export const useAuditRetention = () => {
	const w = useWorkspace();
	return useQuery({
		queryKey: key(w, "audit-retention"),
		queryFn: () => w.client.getAuditRetention(w.slug),
		staleTime: 5 * MINUTE,
	});
};

export const useSetAuditRetention = () => {
	const w = useWorkspace();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (body: AuditRetentionChange) =>
			w.client.setAuditRetention(w.slug, body),
		onSuccess: async (retention) => {
			queryClient.setQueryData(key(w, "audit-retention"), retention);
			await invalidate(queryClient, w, ["admin", "audit"]);
		},
	});
};
