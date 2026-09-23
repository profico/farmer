// A link the app stores and later puts in an `href` or `src` must be http or
// https. `z.url()` accepted `javascript:`, `data:` and `file:` as well.

import { describe, expect, test } from "bun:test";

import { applyDayAssemblyInput } from "./day-assembly";
import { httpUrlSchema } from "./http-url";
import { updateOrganizationSettingsInput } from "./organization";
import { createTimeEntryInput } from "./time-entries";

const TASK = "00000000-0000-4000-8000-000000000001";
const BAD = [
	"javascript:alert(1)",
	"data:text/html,<script>alert(1)</script>",
	"file:///etc/passwd",
	"ftp://example.com/x",
];

describe("an http(s) link", () => {
	test("accepts http and https", () => {
		expect(httpUrlSchema.safeParse("https://meet.google.com/abc").success).toBe(
			true,
		);
		expect(httpUrlSchema.safeParse("http://10.0.0.5:8080/room").success).toBe(
			true,
		);
	});

	test("refuses every other scheme", () => {
		for (const url of BAD) {
			expect(httpUrlSchema.safeParse(url).success).toBe(false);
		}
	});

	test("on a time entry, an assembled day and the org logo", () => {
		for (const url of BAD) {
			expect(
				createTimeEntryInput.safeParse({
					date: "2026-03-02",
					taskId: TASK,
					durationSeconds: 3600,
					meetingUrl: url,
				}).success,
			).toBe(false);
			expect(
				applyDayAssemblyInput.safeParse({
					date: "2026-03-02",
					entries: [{ taskId: TASK, durationSeconds: 3600, meetingUrl: url }],
				}).success,
			).toBe(false);
			expect(
				updateOrganizationSettingsInput.safeParse({ logo: url }).success,
			).toBe(false);
		}
		expect(
			updateOrganizationSettingsInput.safeParse({
				logo: "https://example.com/logo.png",
			}).success,
		).toBe(true);
	});
});
