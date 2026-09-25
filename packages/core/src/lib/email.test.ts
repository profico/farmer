import { afterAll, afterEach, describe, expect, test } from "bun:test";

import nodemailer from "nodemailer";

import { escapeHtml, invitationMail, sendMail, smtpTls } from "./email";
import {
	type SettingName,
	setInstanceSettingsForTests,
} from "./instance-settings";

describe("escapeHtml", () => {
	test("escapes the characters that break out of an element or attribute", () => {
		expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
			"&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;",
		);
	});
});

describe("invitationMail", () => {
	const mail = invitationMail({
		to: "new@example.com",
		inviterName: `Ana <a href="https://evil.example">click</a>`,
		organizationName: "Smith & Co <b>",
		role: "member",
		link: "https://farmer.example/accept-invite/1?org=Smith+%26+Co",
	});

	test("escapes the inviter and organization names in the HTML part", () => {
		expect(mail.html).not.toContain('<a href="https://evil.example">');
		expect(mail.html).toContain(
			"Ana &lt;a href=&quot;https://evil.example&quot;&gt;click&lt;/a&gt;",
		);
		expect(mail.html).toContain("<strong>Smith &amp; Co &lt;b&gt;</strong>");
	});

	test("keeps the plain-text part as typed", () => {
		expect(mail.text).toContain(
			`Ana <a href="https://evil.example">click</a> invited you to join Smith & Co <b> as member.`,
		);
	});

	test("links to the invitation", () => {
		expect(mail.html).toContain(
			'<a href="https://farmer.example/accept-invite/1?org=Smith+%26+Co">',
		);
	});
});

describe("smtpTls", () => {
	test("465 is TLS from the first byte", () => {
		expect(smtpTls(465, "smtp.example.com").secure).toBe(true);
	});

	test("any other port to another machine requires STARTTLS", () => {
		for (const port of [25, 587, 2525]) {
			expect(smtpTls(port, "smtp.example.com")).toEqual({
				secure: false,
				requireTLS: true,
			});
		}
		expect(smtpTls(587, "10.0.0.5").requireTLS).toBe(true);
	});

	test("a server on this machine may speak plain SMTP", () => {
		for (const host of ["localhost", "LOCALHOST", "127.0.0.1", "::1"]) {
			expect(smtpTls(1025, host).requireTLS).toBe(false);
		}
		// nodemailer aims an unset host at localhost.
		expect(smtpTls(1025, undefined).requireTLS).toBe(false);
	});
});

/** A mail server whose EHLO reply offers AUTH and no STARTTLS: one without
 *  TLS, or one whose STARTTLS line somebody on the path deleted. It keeps
 *  every line it receives. */
const plainSmtpServer = () => {
	const lines: string[] = [];
	const reply = (line: string, state: { inData: boolean }): string => {
		if (state.inData) {
			if (line !== ".") return "";
			state.inData = false;
			return "250 queued\r\n";
		}
		const verb = line.split(" ", 1)[0]?.toUpperCase();
		if (verb === "EHLO") return "250-relay.example\r\n250 AUTH PLAIN LOGIN\r\n";
		if (verb === "AUTH") return "235 accepted\r\n";
		if (verb === "MAIL" || verb === "RCPT") return "250 ok\r\n";
		if (verb === "DATA") {
			state.inData = true;
			return "354 go on\r\n";
		}
		if (verb === "QUIT") return "221 bye\r\n";
		return "454 TLS not available\r\n";
	};
	const listener = Bun.listen<{ buffered: string; inData: boolean }>({
		hostname: "127.0.0.1",
		port: 0,
		socket: {
			open(socket) {
				socket.data = { buffered: "", inData: false };
				socket.write("220 relay.example ESMTP\r\n");
			},
			data(socket, chunk) {
				socket.data.buffered += chunk.toString();
				let end = socket.data.buffered.indexOf("\r\n");
				while (end !== -1) {
					const line = socket.data.buffered.slice(0, end);
					socket.data.buffered = socket.data.buffered.slice(end + 2);
					lines.push(line);
					const answer = reply(line, socket.data);
					if (answer) socket.write(answer);
					end = socket.data.buffered.indexOf("\r\n");
				}
			},
		},
	});
	return { lines, port: listener.port, stop: () => listener.stop(true) };
};

const message = {
	to: "new@example.com",
	subject: "Hello",
	text: "Hello",
	html: "<p>Hello</p>",
};

describe("SMTP without STARTTLS", () => {
	const server = plainSmtpServer();
	afterAll(() => server.stop());
	afterEach(() => {
		server.lines.length = 0;
	});

	// The finding: with STARTTLS stripped from the EHLO reply, nodemailer on
	// its own went on to AUTH over the plain socket.
	test("refuses to log in to another machine, so the password stays put", async () => {
		const transporter = nodemailer.createTransport({
			host: "127.0.0.1",
			port: server.port,
			...smtpTls(587, "smtp.example.com"),
			auth: { user: "farmer", pass: "secret" },
		});
		const sent = transporter.sendMail({
			from: "farmer@example.com",
			...message,
		});
		await expect(sent).rejects.toThrow(/STARTTLS/);
		expect(server.lines).toContain("STARTTLS");
		expect(server.lines.some((line) => /^AUTH/i.test(line))).toBe(false);
		expect(server.lines).not.toContain("DATA");
	});

	describe("to a mail catcher on this machine", () => {
		const names: SettingName[] = [
			"EMAIL_PROVIDER",
			"EMAIL_FROM",
			"RESEND_API_KEY",
			"SMTP_HOST",
			"SMTP_PORT",
			"SMTP_USER",
			"SMTP_PASS",
			"SMTP_FROM",
		];
		// The developer's `.env` may set some of these, and a variable wins.
		const saved = new Map(names.map((name) => [name, process.env[name]]));
		afterAll(() => {
			setInstanceSettingsForTests(undefined);
			for (const [name, value] of saved) {
				if (value === undefined) delete process.env[name];
				else process.env[name] = value;
			}
		});

		test("still sends through sendMail", async () => {
			for (const name of names) delete process.env[name];
			setInstanceSettingsForTests({
				EMAIL_PROVIDER: "smtp",
				EMAIL_FROM: "farmer@example.com",
				SMTP_HOST: "127.0.0.1",
				SMTP_PORT: String(server.port),
				SMTP_USER: "farmer",
				SMTP_PASS: "secret",
			});
			await sendMail(message);
			expect(server.lines).toContain("DATA");
			expect(server.lines).toContain(".");
		});
	});
});
