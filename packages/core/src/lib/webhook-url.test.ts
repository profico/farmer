// The address guard.
//
// This is the security boundary of the whole feature, so the table in
// `webhook-url.ts` is pinned address by address rather than "a private range is
// refused". The one that matters most is `169.254.169.254`: on a managed host
// it hands out cloud credentials to anything that asks from inside, and it is
// one text field away from an admin who is allowed to type a URL.

import { afterEach, describe, expect, test } from "bun:test";

import {
	checkWebhookUrlRules,
	fetchWebhookTarget,
	isPublicIpAddress,
	resolveWebhookTarget,
	type WebhookUrlAccepted,
} from "./webhook-url";

afterEach(() => {
	delete process.env.WEBHOOK_ALLOW_PRIVATE_HOSTS;
});

describe("which addresses are somebody else's server", () => {
	test("a public one is", () => {
		for (const address of [
			"8.8.8.8",
			"1.1.1.1",
			"93.184.216.34",
			"2606:2800:220:1:248:1893:25c8:1946",
		]) {
			expect(isPublicIpAddress(address)).toBe(true);
		}
	});

	test("the cloud metadata address is not", () => {
		expect(isPublicIpAddress("169.254.169.254")).toBe(false);
	});

	test("loopback, private, CGNAT, reserved and multicast are not", () => {
		for (const address of [
			"0.0.0.0",
			"127.0.0.1",
			"127.1.2.3",
			"10.0.0.1",
			"172.16.0.1",
			"172.31.255.255",
			"192.168.1.1",
			"100.64.0.1",
			"192.0.0.1",
			"192.0.2.1",
			"192.88.99.1",
			"198.18.0.1",
			"198.51.100.1",
			"203.0.113.1",
			"224.0.0.1",
			"240.0.0.1",
			"255.255.255.255",
		]) {
			expect(isPublicIpAddress(address)).toBe(false);
		}
	});

	test("172.32 and 11.0 are public — the private blocks are not whole octets", () => {
		expect(isPublicIpAddress("172.32.0.1")).toBe(true);
		expect(isPublicIpAddress("11.0.0.1")).toBe(true);
		expect(isPublicIpAddress("100.128.0.1")).toBe(true);
	});

	test("the IPv6 local forms are not", () => {
		for (const address of [
			"::",
			"::1",
			"fc00::1",
			"fd12:3456::1",
			"fe80::1",
			"fe80::1%eth0",
			"ff02::1",
			"2001:db8::1",
			"100::1",
		]) {
			expect(isPublicIpAddress(address)).toBe(false);
		}
	});

	// The disguises. Each of these is a private address wearing IPv6 syntax, and
	// each walks straight through a guard that only pattern-matches the prefix.
	test("an IPv4 address hiding inside IPv6 is classified by what is inside", () => {
		expect(isPublicIpAddress("::ffff:127.0.0.1")).toBe(false);
		expect(isPublicIpAddress("::ffff:169.254.169.254")).toBe(false);
		expect(isPublicIpAddress("::ffff:8.8.8.8")).toBe(true);
		expect(isPublicIpAddress("64:ff9b::10.0.0.1")).toBe(false);
		expect(isPublicIpAddress("2002:a00:1::")).toBe(false);
	});

	test("an octal or malformed literal is refused rather than guessed at", () => {
		// `0177.0.0.1` is 127.0.0.1 to some resolvers. A guard that disagrees
		// with the resolver is not a guard, so it is refused outright.
		expect(isPublicIpAddress("0177.0.0.1")).toBe(false);
		expect(isPublicIpAddress("1.2.3")).toBe(false);
		expect(isPublicIpAddress("999.1.1.1")).toBe(false);
		expect(isPublicIpAddress("not-an-address")).toBe(false);
	});
});

describe("the URL rules", () => {
	test("https is required", () => {
		expect(checkWebhookUrlRules("http://example.com/hook").ok).toBe(false);
		expect(checkWebhookUrlRules("https://example.com/hook").ok).toBe(true);
	});

	test("credentials in the URL are refused", () => {
		const result = checkWebhookUrlRules("https://user:pass@example.com/hook");
		expect(result.ok).toBe(false);
		expect(result.ok ? "" : result.reason).toContain("username and password");
	});

	test("a literal private address is refused without a lookup", () => {
		expect(checkWebhookUrlRules("https://127.0.0.1/hook").ok).toBe(false);
		expect(checkWebhookUrlRules("https://169.254.169.254/latest").ok).toBe(
			false,
		);
		expect(checkWebhookUrlRules("https://[::1]/hook").ok).toBe(false);
	});

	test("nonsense is refused", () => {
		expect(checkWebhookUrlRules("").ok).toBe(false);
		expect(checkWebhookUrlRules("not a url").ok).toBe(false);
		expect(checkWebhookUrlRules(`https://a.com/${"x".repeat(3000)}`).ok).toBe(
			false,
		);
	});

	test("the operator's switch opens both rules and nothing else", () => {
		process.env.WEBHOOK_ALLOW_PRIVATE_HOSTS = "true";
		expect(checkWebhookUrlRules("http://receiver.internal/hook").ok).toBe(true);
		expect(checkWebhookUrlRules("https://127.0.0.1/hook").ok).toBe(true);
		// Still not a URL, still carrying a password.
		expect(checkWebhookUrlRules("not a url").ok).toBe(false);
		expect(checkWebhookUrlRules("https://u:p@127.0.0.1/hook").ok).toBe(false);
	});
});

describe("the lookup", () => {
	test("a name that resolves to loopback is refused", async () => {
		// `localhost` is the one name every machine resolves inward.
		const result = await resolveWebhookTarget("https://localhost/hook");
		expect(result.ok).toBe(false);
	});

	test("a literal public address needs no lookup", async () => {
		const result = await resolveWebhookTarget("https://8.8.8.8/hook");
		expect(result.ok).toBe(true);
		expect(result.ok ? result.addresses : []).toEqual(["8.8.8.8"]);
	});

	test("the operator's switch skips the lookup entirely", async () => {
		process.env.WEBHOOK_ALLOW_PRIVATE_HOSTS = "true";
		const result = await resolveWebhookTarget("http://localhost:9000/hook");
		expect(result.ok).toBe(true);
	});

	test("a refusal names the host, not the address it resolved to", async () => {
		// Echoing the address would let an admin read the deployment's internal
		// DNS: `https://postgres/` answering "resolves to 172.18.0.3".
		const result = await resolveWebhookTarget("https://localhost/hook");
		const reason = result.ok ? "" : result.reason;
		expect(reason).toContain("localhost");
		expect(reason).not.toContain("127.0.0.1");
		expect(reason).not.toContain("::1");
	});
});

describe("the connection", () => {
	// A `.invalid` name never resolves (RFC 6761), so a request that arrives at
	// all proves the connection went to the checked address and the name was
	// not looked up a second time — the lookup a rebinding resolver would win.
	const echoHost = () =>
		Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch: (request) => {
				const url = new URL(request.url);
				return new Response(
					`${request.headers.get("host") ?? ""} ${url.pathname}${url.search}`,
				);
			},
		});

	const targetOn = (port: number, addresses: string[]): WebhookUrlAccepted => ({
		ok: true,
		url: new URL(`http://hook.invalid:${String(port)}/hook?kind=test`),
		addresses,
	});

	test("goes to the checked address and carries the name in Host", async () => {
		const server = echoHost();
		try {
			const response = await fetchWebhookTarget(
				targetOn(server.port ?? 0, ["127.0.0.1"]),
				{ method: "POST", headers: {}, body: "{}" },
				5_000,
			);
			expect(await response.text()).toBe(
				`hook.invalid:${String(server.port)} /hook?kind=test`,
			);
		} finally {
			await server.stop(true);
		}
	});

	test("moves past a checked address that refuses the connection", async () => {
		// Nothing listens on [::1] at this port, so that attempt connects to
		// nothing and sends nothing; the next checked address answers.
		const server = echoHost();
		try {
			const response = await fetchWebhookTarget(
				targetOn(server.port ?? 0, ["::1", "127.0.0.1"]),
				{ method: "POST", headers: {}, body: "{}" },
				5_000,
			);
			expect(response.status).toBe(200);
		} finally {
			await server.stop(true);
		}
	});

	test("moves past a checked IPv6 address a route never reaches", async () => {
		// `2001:db8::1` is the documentation prefix (RFC 3849): never assigned,
		// never routed. On a host with no IPv6 route at all — the case this
		// guards against, a receiver with an AAAA record on a box that only has
		// IPv4 — connecting to ANY global IPv6 literal fails the same way, so
		// this stands in for the receiver's real address. If this address ever
		// connects for some other reason, the test hits a live TLS handshake and
		// fails loudly rather than silently passing.
		const server = echoHost();
		try {
			const response = await fetchWebhookTarget(
				targetOn(server.port ?? 0, ["2001:db8::1", "127.0.0.1"]),
				{ method: "POST", headers: {}, body: "{}" },
				5_000,
			);
			expect(response.status).toBe(200);
		} finally {
			await server.stop(true);
		}
	});
});
