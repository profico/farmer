import { describe, expect, test } from "bun:test";

import { escapeHtml, invitationMail } from "./email";

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
