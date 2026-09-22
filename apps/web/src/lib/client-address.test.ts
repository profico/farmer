/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";

import {
	clientAddress,
	SOCKET_ADDRESS_HEADER,
	trustedIpHeader,
} from "./client-address.ts";

const spoofed = {
	"cf-connecting-ip": "203.0.113.7",
	"x-real-ip": "198.51.100.1",
	"x-forwarded-for": "198.51.100.2, 192.0.2.10",
	[SOCKET_ADDRESS_HEADER]: "10.0.0.2",
};

describe("trustedIpHeader", () => {
	test("defaults to Cloudflare's header", () => {
		expect(trustedIpHeader(undefined)).toBe("cf-connecting-ip");
	});

	test("reads the configured name, and none or empty as no header", () => {
		expect(trustedIpHeader(" X-Real-IP ")).toBe("x-real-ip");
		expect(trustedIpHeader("none")).toBeNull();
		expect(trustedIpHeader("")).toBeNull();
	});
});

describe("clientAddress", () => {
	test("reads the trusted header and nothing else", () => {
		expect(clientAddress(new Headers(spoofed), "cf-connecting-ip")).toBe(
			"203.0.113.7",
		);
		expect(clientAddress(new Headers(spoofed), "x-real-ip")).toBe(
			"198.51.100.1",
		);
	});

	test("takes the last x-forwarded-for entry, the one the proxy appended", () => {
		expect(clientAddress(new Headers(spoofed), "x-forwarded-for")).toBe(
			"192.0.2.10",
		);
	});

	test("ignores the other headers when the trusted one is missing", () => {
		const headers = new Headers({
			"x-real-ip": "198.51.100.1",
			"x-forwarded-for": "198.51.100.2",
			[SOCKET_ADDRESS_HEADER]: "10.0.0.2",
		});
		expect(clientAddress(headers, "cf-connecting-ip")).toBe("10.0.0.2");
	});

	test("uses the socket address when no header is trusted", () => {
		expect(clientAddress(new Headers(spoofed), null)).toBe("10.0.0.2");
	});

	test("answers unknown with neither", () => {
		expect(clientAddress(new Headers({ "x-real-ip": "1.2.3.4" }), null)).toBe(
			"unknown",
		);
	});
});
