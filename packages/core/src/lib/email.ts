import nodemailer, { type Transporter } from "nodemailer";
import { z } from "zod";

import { externalFetch } from "./http";

// Two ways out, one chosen per process:
//  - resend  Resend's HTTP API, when RESEND_API_KEY is set.
//  - smtp    any SMTP server, when SMTP_HOST is set.
// With both configured Resend wins unless EMAIL_PROVIDER names the other one.
// With neither, a send throws — the invitation's badge then reads "Email
// failed" instead of the app claiming it sent something it had nowhere to send.

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
	const chosen = process.env.EMAIL_PROVIDER?.trim().toLowerCase();
	if (chosen === "resend" || chosen === "smtp") return chosen;
	if (chosen)
		throw new Error(
			`EMAIL_PROVIDER must be "resend" or "smtp", not "${chosen}"`,
		);
	if (process.env.RESEND_API_KEY) return "resend";
	if (process.env.SMTP_HOST) return "smtp";
	return null;
};

// EMAIL_FROM is the provider-neutral name; SMTP_FROM and SMTP_USER are what an
// SMTP-only deployment already has set.
const fromAddress = () =>
	process.env.EMAIL_FROM ?? process.env.SMTP_FROM ?? process.env.SMTP_USER;

// Built on first use, not at import: a Resend deployment has no SMTP settings,
// and nodemailer given none quietly aims at localhost.
let transporter: Transporter | undefined;
const smtpTransport = () =>
	(transporter ??= nodemailer.createTransport({
		host: process.env.SMTP_HOST,
		port: Number(process.env.SMTP_PORT ?? 465),
		secure: Number(process.env.SMTP_PORT ?? 465) === 465,
		// A deadline on every step, for the reason `externalFetch` has one:
		// nodemailer's defaults wait two minutes to connect and ten on a quiet
		// socket, so a mail server that stops answering holds its caller that long.
		connectionTimeout: 10_000,
		greetingTimeout: 10_000,
		socketTimeout: 20_000,
		auth: {
			user: process.env.SMTP_USER,
			pass: process.env.SMTP_PASS,
		},
	}));

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
	const key = process.env.RESEND_API_KEY;
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

export const sendMail = async (input: MailInput) => {
	const provider = emailProvider();
	if (provider === "resend") return sendWithResend(input);
	if (provider === "smtp") return sendWithSmtp(input);
	throw new Error(
		"No email provider configured: set RESEND_API_KEY or SMTP_HOST",
	);
};
