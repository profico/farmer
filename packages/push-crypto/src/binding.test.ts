import { describe, expect, test } from "bun:test";

import { bindingProof } from "./binding";

describe("bindingProof", () => {
	// The relay pins the same vector in `apps/push-relay/src/ids.test.ts`.
	test("matches the pinned vector", () => {
		expect(bindingProof("secret-0001", "relay-0001-aaaaaaaa", "key-0001")).toBe(
			"1-SHr1j37PoLDUaBxb7sqZhjtX-y-UODlfxt1Wmq_Us",
		);
	});

	test("changes with the secret, the relay id and the key", () => {
		const base = bindingProof("s", "relay-aaaaaaaaaaaaaaaa", "k");
		expect(bindingProof("t", "relay-aaaaaaaaaaaaaaaa", "k")).not.toBe(base);
		expect(bindingProof("s", "relay-bbbbbbbbbbbbbbbb", "k")).not.toBe(base);
		expect(bindingProof("s", "relay-aaaaaaaaaaaaaaaa", "j")).not.toBe(base);
	});
});
