import { describe, expect, test } from "bun:test";

import { serverFromScan } from "./server-address";

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
