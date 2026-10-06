import { describe, expect, test } from "bun:test";

import { clientAddress, rateLimitBucket } from "./client-address";

describe("rateLimitBucket", () => {
	test("an IPv6 address becomes its /64 prefix", () => {
		expect(rateLimitBucket("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe(
			"2001:db8:1:2::/64",
		);
		expect(rateLimitBucket("2001:db8:1:2::1")).toBe("2001:db8:1:2::/64");
		expect(rateLimitBucket("2001:DB8::1%eth0")).toBe("2001:db8:0:0::/64");
		expect(rateLimitBucket("::1")).toBe("0:0:0:0::/64");
		expect(rateLimitBucket("64:ff9b::192.0.2.1")).toBe("64:ff9b:0:0::/64");
	});

	test("two addresses in one /64 share a bucket", () => {
		expect(rateLimitBucket("2001:db8:1:2::a")).toBe(
			rateLimitBucket("2001:db8:1:2:ffff::b"),
		);
		expect(rateLimitBucket("2001:db8:1:2::a")).not.toBe(
			rateLimitBucket("2001:db8:1:3::a"),
		);
	});

	test("IPv4, unknown and a value that is not an address stay as they are", () => {
		expect(rateLimitBucket("203.0.113.9")).toBe("203.0.113.9");
		expect(rateLimitBucket("unknown")).toBe("unknown");
		expect(rateLimitBucket("1:2:3")).toBe("1:2:3");
		expect(rateLimitBucket("1::2::3")).toBe("1::2::3");
	});
});

describe("clientAddress", () => {
	test("the header's IPv6 address gives the /64 bucket", () => {
		const headers = new Headers({ "cf-connecting-ip": "2001:db8:5:6::99" });
		expect(clientAddress(headers, "cf-connecting-ip", null)).toBe(
			"2001:db8:5:6::/64",
		);
	});

	test("a mapped IPv4 socket address is the IPv4 address", () => {
		expect(clientAddress(new Headers(), null, "::ffff:10.0.1.6")).toBe(
			"10.0.1.6",
		);
	});
});
