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
	isPublicIpAddress,
	resolveWebhookTarget,
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
});
