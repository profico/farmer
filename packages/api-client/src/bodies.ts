/**
 * The request bodies of `/api/v1`, from the server's OpenAPI document. The
 * generated types read a field with a server default as required, so
 * `WithDefaults` makes those fields optional again.
 */

import type { components } from "./openapi.gen";

type Schemas = components["schemas"];

type WithDefaults<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

export type FileTimeEntries = WithDefaults<
	Schemas["FileTimeEntries"],
	"remember"
>;
export type CopyDay = Schemas["CopyDay"];
export type CopyWeek = Schemas["CopyWeek"];
export type AbsenceRange = Schemas["AbsenceRange"];
export type TimerSettingsPatch = Schemas["TimerSettingsPatch"];
export type NotificationSettingsPatch = Schemas["NotificationSettingsPatch"];
export type TaskHidden = Schemas["TaskHidden"];
export type FilingRulePatch = Schemas["FilingRulePatch"];
export type WorkingHoursDayPatch = Schemas["WorkingHoursDayPatch"];
export type NewRecurringBlock = Schemas["NewRecurringBlock"];
export type RecurringBlockPatch = Schemas["RecurringBlockPatch"];
export type IntegrationSettingsPatch = Schemas["IntegrationSettingsPatch"];
export type NewProject = Schemas["NewProject"];
export type NewClient = Schemas["NewClient"];
export type NewTask = Schemas["NewTask"];
export type ReminderSettingsPatch = Schemas["ReminderSettingsPatch"];
export type SlackTestMessage = Schemas["SlackTestMessage"];
export type NewPersonalToken = Schemas["NewPersonalToken"];
export type NewWebhookEndpoint = Schemas["NewWebhookEndpoint"];
export type WebhookEndpointPatch = Schemas["WebhookEndpointPatch"];
export type AuditExportRange = Schemas["AuditExportRange"];
export type AuditRetentionChange = Schemas["AuditRetentionChange"];
export type AssistantConnect = Schemas["AssistantConnect"];
export type AssistantSettingsPatch = Schemas["AssistantSettingsPatch"];
export type NewAssistantThread = Schemas["NewAssistantThread"];
export type AssistantThreadRename = Schemas["AssistantThreadRename"];
export type AssistantSend = Schemas["AssistantSend"];
export type AssistantApproval = Schemas["AssistantApproval"];
export type ProjectPatch = Schemas["ProjectPatch"];
export type NewProjectMember = WithDefaults<
	Schemas["NewProjectMember"],
	"role"
>;
export type ProjectMemberRole = WithDefaults<
	Schemas["ProjectMemberRole"],
	"role"
>;
export type ClientPatch = Schemas["ClientPatch"];
export type TaskPatch = Schemas["TaskPatch"];
export type PersonRole = Schemas["PersonRole"];
export type PersonType = Schemas["PersonType"];
export type PersonStartDate = Schemas["PersonStartDate"];
export type TeamLeadPeople = Schemas["TeamLeadPeople"];
export type NewInvitation = Schemas["NewInvitation"];
export type HourFundEntry = Schemas["HourFundEntry"];
export type HourFundMonthRef = Schemas["HourFundMonthRef"];
export type HourFundYear = Schemas["HourFundYear"];
export type OrganizationPatch = Schemas["OrganizationPatch"];
export type ApplyDayAssembly = Schemas["ApplyDayAssembly"];
export type AttachCommits = Schemas["AttachCommits"];
export type AttachPullRequests = Schemas["AttachPullRequests"];
export type LinkRepository = Schemas["LinkRepository"];
export type ImageUpload = Schemas["ImageUpload"];
export type OrgPolicyPatch = Schemas["OrgPolicyPatch"];
export type HolidaySwitchChange = Schemas["HolidaySwitchChange"];
export type NewOrganization = WithDefaults<
	Schemas["NewOrganization"],
	"timezone" | "country" | "weekStartsOn"
>;
