import { describe, expect, mock, test } from "bun:test";

mock.module("../config", () => ({ USER_AGENT: "test" }));

const { acceptRelayUrl } = await import("./server");

describe("acceptRelayUrl", () => {
	test("accepts an https relay and keeps its path", () => {
		expect(acceptRelayUrl("https://relay.example/base", false)).toBe(
			"https://relay.example/base",
		);
	});

	test("refuses plain http for a remote host", () => {
		expect(acceptRelayUrl("http://relay.example", false)).toBeNull();
		expect(acceptRelayUrl("http://relay.example", true)).toBeNull();
	});

	test("allows http for a local host only in a dev build", () => {
		expect(acceptRelayUrl("http://localhost:8787", true)).toBe(
			"http://localhost:8787",
		);
		expect(acceptRelayUrl("http://localhost:8787", false)).toBeNull();
	});

	test("refuses other schemes and text that is not an address", () => {
		expect(acceptRelayUrl("ftp://relay.example", true)).toBeNull();
		expect(acceptRelayUrl("relay.example", true)).toBeNull();
		expect(acceptRelayUrl("https://", false)).toBeNull();
	});
});
