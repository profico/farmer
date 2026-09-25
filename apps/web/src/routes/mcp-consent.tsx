import type { McpConsentRequest } from "@farmer/core/auth";
import {
	CheckCircleIcon,
	CheckIcon,
	HandIcon,
	HourglassSimpleLowIcon,
} from "@phosphor-icons/react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";

import { AuthSplitPanel } from "#/components/auth-split-panel.tsx";
import { AuthError, AuthHead } from "#/components/site/auth-parts.tsx";
import { authClient } from "#/lib/auth-client.ts";
import { getSession } from "#/server/auth.ts";
import { getPublicAppConfig } from "#/server/config.ts";
import { getMcpConsentRequest } from "#/server/mcp-consent.ts";

/**
 * The approval half of connecting an MCP client — the consent page of
 * better-auth's mcp plugin (`MCP_CONSENT_PAGE` in
 * `packages/core/src/auth/mcp-consent.ts`).
 *
 * Every `/api/auth/mcp/authorize` lands here, signed in, with
 * `?consent_code=…`. Nothing is issued until the person answers: Approve posts
 * to better-auth's `/oauth2/consent`, which answers with the client's redirect
 * carrying a code, and Deny with the same redirect carrying `access_denied`.
 * The browser goes there either way, so the client stops waiting.
 *
 * It is built around the attack that made it necessary: anybody can register
 * a client, under any name, and send a person an authorize link. So the page
 * shows WHERE the access goes (the redirect's scheme and host, which the
 * client cannot fake), not only the name the client gave itself, and asks for
 * a connection the person started. The server holds the rest: a consent code
 * answers only for the account it was made for, and the token endpoint spends
 * no code without the approval.
 *
 * **The code is read from the raw query string**, not from the router's
 * parsed search, for the reason `device.tsx` gives: TanStack Router runs each
 * search value through `JSON.parse`, and an alphanumeric code can come out of
 * that as a number.
 */

const consentCodeFrom = (searchStr: string) =>
	new URLSearchParams(searchStr).get("consent_code");

const consentPath = (consentCode: string | null) =>
	consentCode
		? `/mcp-consent?consent_code=${encodeURIComponent(consentCode)}`
		: "/mcp-consent";

/** better-auth's answer to a decision: where to send the browser next. */
const consentAnswer = z.object({ redirectURI: z.string() });

/** Registration already refuses these (better-auth's `isSafeUrlScheme`); the
 *  check stays here because this page is what would run one. */
const SCRIPT_SCHEMES = new Set(["javascript:", "data:", "vbscript:"]);

const navigable = (redirectURI: string) =>
	URL.canParse(redirectURI) &&
	!SCRIPT_SCHEMES.has(new URL(redirectURI).protocol);

const DECISION_FAILED =
	"Farmer could not record your answer. Check your connection and try again.";

export const Route = createFileRoute("/mcp-consent")({
	beforeLoad: async ({ location }) => {
		const [config, session] = await Promise.all([
			getPublicAppConfig(),
			getSession(),
		]);
		const consentCode = consentCodeFrom(location.searchStr);
		if (!session) {
			// Through `/login`, like `/device`: the query string is part of the
			// same-site path it carries back.
			throw redirect({
				to: "/login",
				search: { redirect: consentPath(consentCode) },
			});
		}
		return { email: session.user.email, brand: config.org, consentCode };
	},
	loader: ({ context }) =>
		context.consentCode
			? getMcpConsentRequest({ data: { consentCode: context.consentCode } })
			: null,
	component: McpConsentPage,
});

function McpConsentPage() {
	const { brand, consentCode } = Route.useRouteContext();
	const request = Route.useLoaderData();

	return (
		<AuthSplitPanel brand={brand}>
			{request && consentCode ? (
				<ConsentDecision consentCode={consentCode} request={request} />
			) : (
				<AuthHead
					icon={HourglassSimpleLowIcon}
					tone="muted"
					size="lg"
					title="This request is no longer waiting"
				>
					It expired, it was already answered, or it was made for another
					account. Start the connection again from your app.
				</AuthHead>
			)}
		</AuthSplitPanel>
	);
}

type Outcome =
	| { state: "approved" }
	| { state: "denied" }
	| { state: "failed"; message: string };

function ConsentDecision({
	consentCode,
	request,
}: {
	consentCode: string;
	request: McpConsentRequest;
}) {
	const { email } = Route.useRouteContext();
	const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
	const [outcome, setOutcome] = useState<Outcome | null>(null);
	const name = request.clientName ?? "An unnamed app";

	const decide = async (accept: boolean) => {
		setBusy(accept ? "approve" : "deny");
		const { data, error } = await authClient.$fetch("/oauth2/consent", {
			method: "POST",
			body: { accept, consent_code: consentCode },
		});
		setBusy(null);
		const answer = consentAnswer.safeParse(data);
		if (error || !answer.success || !navigable(answer.data.redirectURI)) {
			setOutcome({
				state: "failed",
				message: error?.message ?? DECISION_FAILED,
			});
			return;
		}
		setOutcome({ state: accept ? "approved" : "denied" });
		// The client's own redirect. A custom scheme hands it to an app and
		// leaves this tab where it is, which is why the outcome is drawn first.
		window.location.assign(answer.data.redirectURI);
	};

	if (outcome?.state === "approved") {
		return (
			<AuthHead
				icon={CheckCircleIcon}
				tone="accent"
				size="lg"
				title={`${name} is connected`}
			>
				Go back to the app. It finishes connecting on its own, and you can close
				this tab.
			</AuthHead>
		);
	}
	if (outcome?.state === "denied") {
		return (
			<AuthHead
				icon={HandIcon}
				tone="muted"
				size="lg"
				title="Connection denied"
			>
				Nothing was connected. If you did not start this connection, there is
				nothing else to do.
			</AuthHead>
		);
	}

	return (
		<>
			<AuthHead title={`Connect ${name}?`}>
				An app wants to act as you in Farmer: read your time, projects and
				reports, and add, change and delete entries, in every workspace you
				belong to. Approve only a connection that you started yourself, just
				now.
			</AuthHead>
			<div className="fm-auth-table">
				<div>
					<span className="fm-auth-table-label">App</span>
					{name}
				</div>
				<div>
					<span className="fm-auth-table-label">Access goes to</span>
					<span>
						<code className="fm-code">{request.destination}</code>
						{request.local ? " (an app on this computer)" : null}
					</span>
				</div>
				<div>
					<span className="fm-auth-table-label">Account</span>
					{email}
				</div>
			</div>
			<p className="fm-auth-fine">
				The app chose its own name. The address is where Farmer sends your
				access, so check that one.
			</p>
			{outcome?.state === "failed" ? (
				<AuthError>{outcome.message}</AuthError>
			) : null}
			<div className="fm-auth-row">
				<button
					type="button"
					className="fm-btn fm-auth-grow"
					disabled={busy !== null}
					onClick={() => decide(true)}
				>
					<CheckIcon size={16} aria-hidden />
					{busy === "approve" ? "Approving…" : "Approve"}
				</button>
				<button
					type="button"
					className="fm-btn fm-btn-outline"
					disabled={busy !== null}
					onClick={() => decide(false)}
				>
					{busy === "deny" ? "Denying…" : "Deny"}
				</button>
			</div>
		</>
	);
}
