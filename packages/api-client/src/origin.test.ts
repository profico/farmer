import { describe, expect, test } from "bun:test";

import { ApiClientError } from "./errors";
import { normalizeOrigin } from "./origin";

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
