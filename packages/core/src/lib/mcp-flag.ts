import { settingEnabled } from "./instance-settings";

/**
 * The MCP server's kill switch — one instance setting, default on.
 *
 * `MCP_ENABLED=false` takes the endpoint away: `/api/mcp/<slug>` 404s and the
 * connection URL disappears from Settings → Integrations. The OAuth
 * authorization server stays mounted, because a token that was already issued
 * is a credential the operator may still want to revoke rather than one that
 * silently stops resolving.
 *
 * Deliberately NOT `isAssistantEnabled`. The two features share a tool
 * registry and nothing else: `assistantSettings` is about OpenRouter — a key, a
 * model, a per-org pause — and an MCP client brings its own model, so none of
 * it applies. An operator who switches the assistant off is saying they don't
 * want this deployment calling OpenRouter, which is not a statement about
 * whether Claude Code may read a timesheet.
 *
 * An instance setting with the default "true", for the same reasons as
 * `lib/assistant-flag.ts`. The client learns the flag from
 * `getPublicAppConfig`. Read per call, like the other two.
 */
export const isMcpEnabled = (): boolean => settingEnabled("MCP_ENABLED");
