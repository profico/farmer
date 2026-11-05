import { describe, expect, test } from "bun:test";

import {
	askForTimerNotifications,
	needsDeniedHint,
	type PermissionApi,
	type PermissionState,
} from "./timer-permission";

/** A permission API with a fixed current state and a fixed answer, which
 *  counts the dialogs that it shows. */
const fake = (current: PermissionState, answer: PermissionState) => {
	const calls = { request: 0 };
	const api: PermissionApi = {
		get: async () => current,
		request: async () => {
			calls.request += 1;
			return answer;
		},
	};
	return { api, calls };
};

const GRANTED = { granted: true, canAskAgain: true };
const ASKABLE = { granted: false, canAskAgain: true };
const BLOCKED = { granted: false, canAskAgain: false };

describe("askForTimerNotifications", () => {
	test("asks again at each start while the system can ask", async () => {
		const { api, calls } = fake(ASKABLE, ASKABLE);
		await askForTimerNotifications(api);
		const second = await askForTimerNotifications(api);
		expect(calls.request).toBe(2);
		expect(second).toEqual({ granted: false, asked: true });
	});

	test("shows no dialog when the permission is granted", async () => {
		const { api, calls } = fake(GRANTED, GRANTED);
		expect(await askForTimerNotifications(api)).toEqual({
			granted: true,
			asked: false,
		});
		expect(calls.request).toBe(0);
	});

	test("shows no dialog when the system cannot ask", async () => {
		const { api, calls } = fake(BLOCKED, GRANTED);
		expect(await askForTimerNotifications(api)).toEqual({
			granted: false,
			asked: false,
		});
		expect(calls.request).toBe(0);
	});

	test("returns the answer of the dialog", async () => {
		const { api } = fake(ASKABLE, GRANTED);
		expect(await askForTimerNotifications(api)).toEqual({
			granted: true,
			asked: true,
		});
	});

	test("a failed read counts as not granted", async () => {
		const api: PermissionApi = {
			get: () => Promise.reject(new Error("no activity")),
			request: async () => GRANTED,
		};
		expect(await askForTimerNotifications(api)).toEqual({
			granted: false,
			asked: false,
		});
	});
});

describe("needsDeniedHint", () => {
	test("shows the hint one time after a refusal", () => {
		const refused = { granted: false, asked: true };
		expect(needsDeniedHint(refused, false)).toBe(true);
		expect(needsDeniedHint(refused, true)).toBe(false);
		expect(needsDeniedHint({ granted: true, asked: true }, false)).toBe(false);
	});
});
