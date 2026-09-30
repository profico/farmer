/** Characters no shell reads specially, anywhere in a word. */
const PLAIN = /^[\w./:-]+$/;

/** Characters a single-quoted word cannot hold the same way in every shell:
 *  `'`, `\` and the typographic single quotes, U+2018 to U+201B. */
const UNQUOTABLE = /['\\‘-‛]/g;

/** Close the single quotes, double-quote `char` alone, and open them again. */
const alone = (char: string): string => `'"${char === "\\" ? "\\\\" : char}"'`;

/**
 * `value` as one literal word on a shell command line, for a command the app
 * shows somebody to paste into their own terminal.
 *
 * Part of such a command can come from somebody else: the MCP command names
 * the workspace's slug, which a workspace admin sets. Left bare, a `$(…)` in
 * it runs on the machine of whoever pastes the command.
 *
 * A value made only of `PLAIN` characters comes back as it is, so an ordinary
 * URL reads the same as before. Anything else goes in single quotes, inside
 * which sh, bash, zsh, fish and PowerShell expand nothing. The `UNQUOTABLE`
 * characters are closed out of the quotes and double-quoted alone: the ASCII
 * quote, the backslash (fish reads `\'` and `\\` inside single quotes) and the
 * typographic single quotes (PowerShell ends a single-quoted string on those
 * too). Nothing else ever sits in those double quotes, so nothing there
 * expands either.
 */
export const shellQuote = (value: string): string =>
	PLAIN.test(value) ? value : `'${value.replace(UNQUOTABLE, alone)}'`;
