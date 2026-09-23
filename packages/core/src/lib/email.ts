import nodemailer, { type Transporter } from "nodemailer";
import { z } from "zod";

import { externalFetch } from "./http";
import { setting } from "./instance-settings";

// Two ways out, one chosen per process:
//  - resend  Resend's HTTP API, when RESEND_API_KEY is set.
//  - smtp    any SMTP server, when SMTP_HOST is set.
// With both configured Resend wins unless EMAIL_PROVIDER names the other one.
// With neither, a send throws — the invitation's badge then reads "Email
// failed" instead of the app claiming it sent something it had nowhere to send.
//
// Every value is an instance setting (`lib/instance-settings.ts`): the
// environment, else the Infrastructure page. They are read per send, so a
// change on the page reaches the next message without a restart.

export type EmailProvider = "resend" | "smtp";

type MailInput = {
	to: string;
	subject: string;
	html: string;
	text: string;
};

/** Which provider this process sends through, or null when none is set up.
 *  Throws on an EMAIL_PROVIDER it does not know, rather than guessing. */
export const emailProvider = (): EmailProvider | null => {
	const chosen = setting("EMAIL_PROVIDER")?.trim().toLowerCase();
	if (chosen === "resend" || chosen === "smtp") return chosen;
	if (chosen)
		throw new Error(
			`EMAIL_PROVIDER must be "resend" or "smtp", not "${chosen}"`,
		);
	if (setting("RESEND_API_KEY")) return "resend";
	if (setting("SMTP_HOST")) return "smtp";
	return null;
};

// EMAIL_FROM is the provider-neutral name; SMTP_FROM and SMTP_USER are what an
// SMTP-only deployment already has set.
const fromAddress = () =>
	setting("EMAIL_FROM") ?? setting("SMTP_FROM") ?? setting("SMTP_USER");

// Built on first use, not at import: a Resend deployment has no SMTP settings,
// and nodemailer given none quietly aims at localhost.
//
// Kept together with the values it was built from, and rebuilt when they
// differ: an admin who fixes a wrong password on the page must not keep
// sending through the transport that holds the old one.
let transport: { key: string; transporter: Transporter } | undefined;
const smtpTransport = (): Transporter => {
	// The page refuses a port that is not one, but the environment is not
	// checked. `Number("587a")` is NaN, and nodemailer would fail on the socket
	// with an error that never names the port.
	const port = Number(setting("SMTP_PORT") ?? 465);
	if (!Number.isInteger(port) || port < 1 || port > 65_535) {
		throw new Error(`SMTP_PORT must be a port from 1 to 65535`);
	}
	const options = {
		host: setting("SMTP_HOST"),
		port,
		user: setting("SMTP_USER"),
		pass: setting("SMTP_PASS"),
	};
	const key = JSON.stringify(options);
	if (transport?.key === key) return transport.transporter;
	transport?.transporter.close();
	const transporter = nodemailer.createTransport({
		host: options.host,
		port,
		secure: port === 465,
		// A deadline on every step, for the reason `externalFetch` has one:
		// nodemailer's defaults wait two minutes to connect and ten on a quiet
		// socket, so a mail server that stops answering holds its caller that long.
		connectionTimeout: 10_000,
		greetingTimeout: 10_000,
		socketTimeout: 20_000,
		auth: { user: options.user, pass: options.pass },
	});
	transport = { key, transporter };
	return transporter;
};

const sendWithSmtp = async (input: MailInput) => {
	await smtpTransport().sendMail({ from: fromAddress(), ...input });
};

// Resend answers a refusal with `{ statusCode, name, message }`; the message is
// the part worth putting in front of an admin.
const resendError = z.object({ message: z.string() });

const readResendError = (body: string): string => {
	try {
		const parsed = resendError.safeParse(JSON.parse(body));
		if (parsed.success) return parsed.data.message;
	} catch {
		// Not JSON — a proxy's error page, say. The raw text is all there is.
	}
	return body.slice(0, 300);
};

const sendWithResend = async (input: MailInput) => {
	const key = setting("RESEND_API_KEY");
	if (!key)
		throw new Error("EMAIL_PROVIDER is resend but RESEND_API_KEY is unset");
	const from = fromAddress();
	if (!from)
		throw new Error(
			"Set EMAIL_FROM to a sender on a domain verified in Resend",
		);

	const res = await externalFetch("https://api.resend.com/emails", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${key}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			from,
			to: [input.to],
			subject: input.subject,
			html: input.html,
			text: input.text,
		}),
	});
	if (!res.ok) {
		throw new Error(
			`Resend ${res.status}: ${readResendError(await res.text())}`,
		);
	}
};

/** Escapes the five characters that let text break out of an HTML element
 *  or a quoted attribute. */
export const escapeHtml = (text: string): string =>
	text
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");

/** The invitation email. The inviter's name and the organization's name are
 *  whatever a person typed into a profile or a settings form, so the HTML part
 *  escapes every one of them — unescaped, an admin could put markup (a link to
 *  anywhere, a fake button) into an email that arrives from this deployment's
 *  own sender. The plain-text part is not HTML and goes out as typed. */
export const invitationMail = (input: {
	to: string;
	inviterName: string;
	organizationName: string;
	role: string;
	link: string;
}): MailInput => {
	const { inviterName, organizationName, role, link } = input;
	return {
		to: input.to,
		subject: `${inviterName} invited you to join ${organizationName}`,
		text: `${inviterName} invited you to join ${organizationName} as ${role}.\n\nAccept the invitation: ${link}`,
		html: `<p>${escapeHtml(inviterName)} invited you to join <strong>${escapeHtml(organizationName)}</strong> as ${escapeHtml(role)}.</p><p><a href="${escapeHtml(link)}">Accept the invitation</a></p>`,
	};
};

export const sendMail = async (input: MailInput) => {
	const provider = emailProvider();
	if (provider === "resend") return sendWithResend(input);
	if (provider === "smtp") return sendWithSmtp(input);
	throw new Error(
		"No email provider configured: set RESEND_API_KEY or SMTP_HOST",
	);
};
