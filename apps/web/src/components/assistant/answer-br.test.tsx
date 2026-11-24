// A model's `<br>` is a line break in a table cell, and literal in a code span.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { renderToStaticMarkup } from "react-dom/server";

let html: (text: string) => string;

beforeAll(async () => {
	// `answer.tsx` reads `window` when it loads, so import it after the fake DOM.
	GlobalRegistrator.register();
	const { Answer } = await import("./answer.tsx");
	html = (text) => renderToStaticMarkup(<Answer text={text} />);
});

afterAll(async () => {
	await GlobalRegistrator.unregister();
});

describe("Answer <br>", () => {
	test("a table cell keeps the break and shows it", () => {
		const out = html("| A | B |\n|---|---|\n| one<br>two | x |");
		expect(out).toContain("one\ntwo");
		expect(out).toContain("whitespace-pre");
		expect(out).not.toContain("&lt;br");
	});

	test("a code span keeps the tag literal", () => {
		const out = html("see `a<br>b` here");
		expect(out).toContain("a&lt;br&gt;b");
		expect(out).not.toContain("a\nb");
	});
});
