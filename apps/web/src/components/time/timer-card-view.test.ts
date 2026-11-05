import { describe, expect, test } from "bun:test";

import {
	cardEyebrowClass,
	cardFigureClass,
	railAction,
	railAriaLabel,
	railFigureClass,
	railTagClass,
	railTagText,
	taskLine,
	timerStateLabel,
	timerStatusText,
} from "./timer-card-view.ts";

const running = { dropped: false, elsewhere: false, paused: false };

describe("timer card view", () => {
	test("state label prefers dropped over paused", () => {
		expect(timerStateLabel({ dropped: true, paused: true })).toBe("Dropped");
		expect(timerStateLabel({ dropped: false, paused: true })).toBe("Paused");
		expect(timerStateLabel({ dropped: false, paused: false })).toBe("Running");
	});

	test("status text names the other workspace", () => {
		expect(timerStatusText("Running", true, "Acme")).toBe("Running in Acme");
		expect(timerStatusText("Running", false, "Acme")).toBe("Running");
	});

	test("eyebrow and figure tints", () => {
		expect(cardEyebrowClass(running)).toBe("eyebrow truncate text-ok");
		expect(cardEyebrowClass({ ...running, elsewhere: true })).toBe(
			"eyebrow truncate",
		);
		expect(cardEyebrowClass({ ...running, paused: true })).toBe(
			"eyebrow truncate",
		);
		expect(cardEyebrowClass({ ...running, dropped: true })).toBe(
			"eyebrow truncate text-warn",
		);
		expect(cardFigureClass({ ...running, paused: true })).toContain(
			"text-muted-foreground",
		);
		expect(
			cardFigureClass({ ...running, dropped: true, paused: true }),
		).toContain("text-warn");
		expect(
			cardFigureClass({ ...running, dropped: true, paused: true }),
		).not.toContain("text-muted-foreground");
		expect(railTagClass(running)).toBe("eyebrow text-ok");
		expect(railFigureClass(running)).toBe("mono text-2xs tabular-nums");
	});

	test("rail text", () => {
		expect(railTagText({ dropped: true, paused: false })).toBe("Drop");
		expect(railTagText({ dropped: false, paused: true })).toBe("Held");
		expect(railTagText({ dropped: false, paused: false })).toBe("Run");
	});

	test("rail label and action", () => {
		expect(
			railAriaLabel(
				{ dropped: true, elsewhere: true },
				"Dropped",
				"A",
				"0:00:01",
				"T",
			),
		).toBe("Your timer was dropped");
		expect(
			railAriaLabel(
				{ dropped: false, elsewhere: true },
				"Paused",
				"A",
				"0:00:01",
				"T",
			),
		).toBe("A timer is paused in A");
		expect(
			railAriaLabel(
				{ dropped: false, elsewhere: false },
				"Running",
				"A",
				"0:00:01",
				"T",
			),
		).toBe("Stop the timer — 0:00:01 on T");
		expect(railAction({ dropped: true, elsewhere: true })).toBe("dismiss");
		expect(railAction({ dropped: false, elsewhere: true })).toBe("none");
		expect(railAction({ dropped: false, elsewhere: false })).toBe("stop");
	});

	test("task line", () => {
		expect(taskLine("Dev", null)).toBe("Dev");
		expect(taskLine("Dev", "5 Oct")).toBe("Dev · adds to 5 Oct");
	});
});
