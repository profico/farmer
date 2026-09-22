export * from "./access.service";
export * from "./account.service";
// The analytics seam: the event shapes a turn reports, and the setter that
// installs a sink for them. Exported because the adapter lives in `apps/web`,
// beside the vendor's credentials — see `lib/posthog-ai.ts`.
export * from "./ai-telemetry";
export * from "./assistant.service";
export * from "./assistant-tools";
export * from "./clients.service";
export * from "./compliance.service";
// The request-scoped helpers (ctxAccess, ctxTimezone, withCtxTx, …) are part of
// the service API, not an internal: the web boundary resolves Access through
// `ctxAccess` so the memo it warms is the one the handler's services read.
export * from "./context";
export * from "./day-assembly.service";
// What a client may be told about an error a service threw — shared by the
// CLI's API, the MCP server and the assistant's tool results.
export * from "./error-message";
// The outbound half of `notify`: the outbox seam every service emits through.
// See the header of events.ts for why `build` is a function.
export * from "./events";
export * from "./filing-rules.service";
export * from "./github.service";
export * from "./google-calendar.service";
export * from "./harvest-import.service";
export * from "./holidays.service";
export * from "./hour-fund.service";
export * from "./integration-settings.service";
export * from "./mcp-tools";
export * from "./members.service";
export * from "./notifications.service";
export * from "./notify";
export * from "./org-context.service";
export * from "./org-settings.service";
export * from "./organization.service";
// Instance-level rather than workspace-level, and therefore the one service
// whose functions take no `Ctx` — the header says why.
export * from "./platform-admins.service";
export * from "./projects.service";
export * from "./recurring-block-rules.service";
export * from "./reminder-settings.service";
export * from "./reports.service";
export * from "./rewind.service";
export * from "./sessions.service";
export * from "./slack.service";
export * from "./tasks.service";
export * from "./team-leads.service";
export * from "./time-entries.service";
export * from "./timers.service";
export * from "./types";
export * from "./unfiled";
export * from "./uploads.service";
export * from "./webhooks.service";
export * from "./working-hours.service";
