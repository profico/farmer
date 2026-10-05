import {
	type ApiIntegrations,
	toApiIntegrationSettings,
} from "@farmer/core/api";
import type { Ctx, IntegrationProvider } from "@farmer/core/services";

/** The caller's GitHub and Google Calendar connections and switches, as
 *  `GET /api/v1/…/integrations` answers them. */
export const integrationsOf = async (ctx: Ctx): Promise<ApiIntegrations> => {
	const { githubService, googleCalendarService, integrationSettingsService } =
		await import("@farmer/core/services");
	const [github, google, settings] = await Promise.all([
		githubService.connectionStatus(ctx),
		googleCalendarService.connectionStatus(ctx),
		integrationSettingsService.get(ctx),
	]);
	return {
		github: {
			connected: github.connected,
			login: github.login,
			unreachable: github.unreachable,
			needsReconnect: github.needsReconnect,
		},
		googleCalendar: {
			connected: google.connected,
			email: google.email,
			unreachable: google.unreachable,
		},
		settings: toApiIntegrationSettings(settings),
	};
};

/** Disconnect one integration of the caller, then answer the new state. A
 *  grant that is not there is a 404, so the app never reports a disconnect
 *  that did not happen. */
export const unlinkIntegration = async (
	ctx: Ctx,
	provider: IntegrationProvider,
): Promise<ApiIntegrations> => {
	const { accountService } = await import("@farmer/core/services");
	const removed = await accountService.unlinkIntegration(ctx, provider);
	if (!removed) throw new Error("Connection not found");
	return integrationsOf(ctx);
};
