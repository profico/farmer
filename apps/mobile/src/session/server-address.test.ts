import { describe, expect, test } from "bun:test";

import {
	defaultServerFrom,
	serverFromScan,
	signInOrigin,
} from "./server-address";

describe("serverFromScan", () => {
	test("reads the web app's connect link", () => {
		expect(
			serverFromScan(
				"farmer://connect?server=https%3A%2F%2Ffarmer.example.com%2Facme",
			),
		).toBe("https://farmer.example.com");
		expect(serverFromScan("farmer://connect?server=farmer.example.com")).toBe(
			"https://farmer.example.com",
		);
	});

	test("reads a plain https address", () => {
		expect(serverFromScan(" https://Farmer.Example.com:443/time ")).toBe(
			"https://farmer.example.com",
		);
	});

	test("refuses every other text", () => {
		for (const data of [
			"",
			"hello",
			"http://farmer.example.com",
			"farmer://auth-callback?cookie=x",
			"farmer://connect?other=1",
			"farmer://connect?server=javascript:alert(1)",
			"WIFI:S:office;T:WPA;P:secret;;",
		]) {
			expect(serverFromScan(data)).toBeNull();
		}
	});
});

describe("signInOrigin", () => {
	test("takes the origin that the Server screen sends", () => {
		expect(signInOrigin("https://farmer.example.com")).toBe(
			"https://farmer.example.com",
		);
		expect(signInOrigin("http://10.0.2.2:3000")).toBe("http://10.0.2.2:3000");
	});

	test("refuses a parameter that the Server screen would not send", () => {
		expect(signInOrigin(undefined)).toBeNull();
		expect(signInOrigin("")).toBeNull();
		// Plain http to a remote host.
		expect(signInOrigin("http://evil.example")).toBeNull();
		// Not an origin: a path, another scheme, a host without a scheme.
		expect(signInOrigin("https://farmer.example.com/acme")).toBeNull();
		expect(signInOrigin("javascript:alert(1)")).toBeNull();
		expect(signInOrigin("farmer.example.com")).toBeNull();
	});
});

describe("defaultServerFrom", () => {
	test("returns the origin of a build setting", () => {
		expect(
			defaultServerFrom({ defaultServer: "https://farmer.profi.co" }),
		).toBe("https://farmer.profi.co");
		expect(defaultServerFrom({ defaultServer: " farmer.profi.co/ " })).toBe(
			"https://farmer.profi.co",
		);
	});

	test("returns null when the build sets none", () => {
		expect(defaultServerFrom(undefined)).toBeNull();
		expect(defaultServerFrom(null)).toBeNull();
		expect(defaultServerFrom({})).toBeNull();
		expect(defaultServerFrom({ defaultServer: null })).toBeNull();
		expect(defaultServerFrom({ defaultServer: "  " })).toBeNull();
	});

	test("ignores a value that is not an address", () => {
		expect(defaultServerFrom({ defaultServer: "not a server" })).toBeNull();
	});
});
