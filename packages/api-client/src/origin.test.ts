import { describe, expect, test } from "bun:test";

import { ApiClientError } from "./errors";
import { isLocalHost, normalizeOrigin } from "./origin";

describe("normalizeOrigin", () => {
	test.each([
		["farmer.example.com", "https://farmer.example.com"],
		["https://farmer.example.com/acme/time", "https://farmer.example.com"],
		["HTTPS://Farmer.Example.com:443/", "https://farmer.example.com"],
		["localhost:3000", "http://localhost:3000"],
		["10.0.2.2:3000", "http://10.0.2.2:3000"],
		["http://192.168.1.4:3000/x?y#z", "http://192.168.1.4:3000"],
		["  farmer.example.com  ", "https://farmer.example.com"],
	])("%s gives %s", (input, origin) => {
		expect(normalizeOrigin(input)).toBe(origin);
	});

	test.each(["", "ftp://farmer.example.com", "https://", "not a host"])(
		"refuses %p",
		(input) => {
			expect(() => normalizeOrigin(input)).toThrow(ApiClientError);
		},
	);
});

describe("plain http", () => {
	test.each([
		"http://localhost:3000",
		"http://127.0.0.1:3000",
		"http://127.1.2.3",
		"http://10.0.2.2:3000",
		"http://10.20.30.40",
		"http://172.16.0.1",
		"http://172.31.255.255",
		"http://192.168.1.4:3000",
		"http://farmer.local:3000",
		"http://[::1]:3000",
		"http://[fd12:3456::1]:3000",
		"http://[fc00::1]",
	])("accepts the local host of %s", (input) => {
		expect(() => normalizeOrigin(input)).not.toThrow();
	});

	test.each([
		"http://farmer.example.com",
		"http://8.8.8.8",
		"http://172.32.0.1",
		"http://172.15.0.1",
		"http://192.169.1.1",
		"http://10.evil.example",
		"http://localhost.evil.example",
		"http://[2001:db8::1]",
		"http://[fe80::1]",
	])("refuses the remote host of %s", (input) => {
		expect(() => normalizeOrigin(input)).toThrow("plain http");
	});

	test("an option accepts a remote host on plain http", () => {
		expect(
			normalizeOrigin("http://farmer.example.com", { allowRemoteHttp: true }),
		).toBe("http://farmer.example.com");
	});

	test("https is accepted for any host", () => {
		expect(normalizeOrigin("https://8.8.8.8")).toBe("https://8.8.8.8");
	});
});

describe("isLocalHost", () => {
	test("takes a bracketed IPv6 host as the URL gives it", () => {
		expect(isLocalHost("[::1]")).toBe(true);
		expect(isLocalHost("[0:0:0:0:0:0:0:1]")).toBe(true);
		expect(isLocalHost("[::2]")).toBe(false);
	});

	test("refuses a value that is not a strict IPv4 address", () => {
		expect(isLocalHost("10.0.0")).toBe(false);
		expect(isLocalHost("10.0.0.256")).toBe(false);
		expect(isLocalHost("192.168.1.1.example")).toBe(false);
	});
});
