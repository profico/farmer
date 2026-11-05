/// <reference types="bun-types" />
import { describe, expect, spyOn, test } from "bun:test";

import {
	clientAddress,
	resetClientAddressWarningForTests,
	SOCKET_ADDRESS_HEADER,
	trustedIpHeader,
} from "./client-address";

const spoofed = {
	"cf-connecting-ip": "203.0.113.7",
	"x-real-ip": "198.51.100.1",
	"x-forwarded-for": "198.51.100.2, 192.0.2.10",
	[SOCKET_ADDRESS_HEADER]: "10.0.0.2",
};

describe("trustedIpHeader", () => {
	test("defaults to no header, the socket address", () => {
		expect(trustedIpHeader(undefined)).toBeNull();
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

	test("does not let a caller choose its address with the default", () => {
		const headers = new Headers({
			"cf-connecting-ip": "203.0.113.99",
			[SOCKET_ADDRESS_HEADER]: "10.0.0.2",
		});
		expect(clientAddress(headers, trustedIpHeader(undefined))).toBe("10.0.0.2");
	});

	test("unmaps the IPv4 a dual-stack socket reports as IPv6", () => {
		const headers = new Headers({
			"cf-connecting-ip": "::ffff:203.0.113.7",
			[SOCKET_ADDRESS_HEADER]: "::ffff:10.0.1.6",
		});
		expect(clientAddress(headers, "cf-connecting-ip")).toBe("203.0.113.7");
		expect(clientAddress(headers, null)).toBe("10.0.1.6");
	});

	test("leaves a real IPv6 address alone", () => {
		const headers = new Headers({ "cf-connecting-ip": "2001:db8::1" });
		expect(clientAddress(headers, "cf-connecting-ip")).toBe("2001:db8::1");
	});

	test("answers unknown with neither", () => {
		expect(clientAddress(new Headers({ "x-real-ip": "1.2.3.4" }), null)).toBe(
			"unknown",
		);
	});
});

describe("a missing trusted header", () => {
	test("warns one time when another proxy's header is present", () => {
		resetClientAddressWarningForTests();
		const warn = spyOn(console, "warn").mockImplementation(() => {});
		try {
			const headers = new Headers({
				"x-forwarded-for": "198.51.100.2",
				[SOCKET_ADDRESS_HEADER]: "10.0.0.2",
			});
			expect(clientAddress(headers, "cf-connecting-ip")).toBe("10.0.0.2");
			expect(clientAddress(headers, "cf-connecting-ip")).toBe("10.0.0.2");
			expect(warn).toHaveBeenCalledTimes(1);
		} finally {
			warn.mockRestore();
		}
	});

	test("warns when no header is trusted and a forwarding header is present", () => {
		resetClientAddressWarningForTests();
		const warn = spyOn(console, "warn").mockImplementation(() => {});
		try {
			const headers = new Headers({
				"x-forwarded-for": "198.51.100.2",
				[SOCKET_ADDRESS_HEADER]: "10.0.0.2",
			});
			expect(clientAddress(headers, null)).toBe("10.0.0.2");
			expect(warn).toHaveBeenCalledTimes(1);
		} finally {
			warn.mockRestore();
		}
	});

	test("stays quiet when no proxy header is present", () => {
		resetClientAddressWarningForTests();
		const warn = spyOn(console, "warn").mockImplementation(() => {});
		try {
			clientAddress(
				new Headers({ [SOCKET_ADDRESS_HEADER]: "10.0.0.2" }),
				"cf-connecting-ip",
			);
			expect(warn).not.toHaveBeenCalled();
		} finally {
			warn.mockRestore();
		}
	});
});
