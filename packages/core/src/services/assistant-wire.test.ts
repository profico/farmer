import { describe, expect, test } from "bun:test";

import type { ChatMessage } from "../lib/openrouter-client";
import { at } from "../test/harness";
import {
	ELIDE_MIN_CHARS,
	ELIDED_RESULT,
	elideOldToolResults,
	KEEP_TOOL_RESULT_TURNS,
} from "./assistant-wire";

const big = "x".repeat(ELIDE_MIN_CHARS + 1);

/** One turn: user, assistant with a call, and the tool result. */
const turn = (n: number, result: string): ChatMessage[] => [
	{ role: "user", content: `q${n}` },
	{
		role: "assistant",
		content: "",
		tool_calls: [
			{
				id: `c${n}`,
				type: "function",
				function: { name: "t", arguments: "{}" },
			},
		],
	},
	{ role: "tool", content: result, tool_call_id: `c${n}` },
];

const toolRows = (wire: ChatMessage[]) =>
	wire.flatMap((m) => (m.role === "tool" ? [m] : []));

describe("elideOldToolResults", () => {
	test("stubs big results older than the window", () => {
		const turns = KEEP_TOOL_RESULT_TURNS + 2;
		const wire = Array.from({ length: turns }, (_, n) => turn(n, big)).flat();
		const out = toolRows(elideOldToolResults(wire));
		expect(out).toHaveLength(turns);
		out.forEach((row, n) => {
			const old = n < 2;
			expect(row.tool_call_id).toBe(`c${n}`);
			expect(row.content).toBe(old ? ELIDED_RESULT : big);
		});
	});

	test("keeps small results and the current turn", () => {
		const wire = [
			...turn(0, "tiny"),
			...turn(1, big),
			...turn(2, big),
			...turn(3, big),
			...turn(4, big),
			...turn(5, big),
		];
		const out = toolRows(elideOldToolResults(wire));
		expect(at(out, 0).content).toBe("tiny");
		expect(at(out, 1).content).toBe(ELIDED_RESULT);
		expect(at(out, 5).content).toBe(big);
	});

	test("leaves a short thread and the input untouched", () => {
		const wire = turn(0, big);
		expect(elideOldToolResults(wire)).toBe(wire);
		expect(at(wire, 2)).toEqual({
			role: "tool",
			content: big,
			tool_call_id: "c0",
		});
	});
});
