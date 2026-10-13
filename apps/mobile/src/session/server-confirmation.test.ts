import { afterEach, describe, expect, test } from "bun:test";

import {
	clearServerConfirmation,
	confirmServer,
	isServerConfirmed,
} from "./server-confirmation";

afterEach(clearServerConfirmation);

describe("server confirmation", () => {
	test("refuses an origin that nobody confirmed", () => {
		expect(isServerConfirmed("https://attacker.example")).toBe(false);
		expect(isServerConfirmed(null)).toBe(false);
	});

	test("accepts only the confirmed origin", () => {
		confirmServer("https://farmer.example.com");
		expect(isServerConfirmed("https://farmer.example.com")).toBe(true);
		expect(isServerConfirmed("https://attacker.example")).toBe(false);
	});

	test("a new confirmation replaces the old one", () => {
		confirmServer("https://farmer.example.com");
		confirmServer("https://other.example.com");
		expect(isServerConfirmed("https://farmer.example.com")).toBe(false);
	});
});
