import { ApiClientError } from "./errors";
import { type Meta, metaSchema } from "./schemas";
import { readJson, send, type Transport } from "./transport";
import { isVersionAtLeast } from "./version";

/**
 * `GET /api/v1/meta`, parsed. The answer is also the proof that the address
 * is a Farmer server at all.
 */
export const fetchMeta = async (transport: Transport): Promise<Meta> => {
	const notFarmer = new ApiClientError(
		"not_farmer",
		`${transport.origin} does not look like a Farmer server. Check the address.`,
	);
	const response = await send(transport, {
		method: "GET",
		path: "/api/v1/meta",
		token: null,
	});
	if (!response.ok) throw notFarmer;
	const parsed = metaSchema.safeParse(await readJson(response));
	if (!parsed.success) throw notFarmer;
	return parsed.data;
};

/**
 * Refuses a server this app cannot use: one with the API switched off, and
 * one that asks for a newer app.
 */
export const assertUsable = (
	meta: Meta,
	origin: string,
	appVersion: string,
) => {
	if (!meta.cliEnabled) {
		throw new ApiClientError(
			"api_disabled",
			`The API is switched off on ${origin}, so the app cannot connect. Ask the administrator of that server.`,
		);
	}
	if (
		meta.minMobileVersion &&
		!isVersionAtLeast(appVersion, meta.minMobileVersion)
	) {
		throw new ApiClientError(
			"update_required",
			`${origin} needs a newer version of the app. Update the app.`,
		);
	}
};
