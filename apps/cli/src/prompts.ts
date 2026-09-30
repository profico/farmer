import * as clack from "@clack/prompts";
import { matchesSearch } from "@farmer/core/lib/search";

import { CancelledError, UsageError } from "./errors";
import { type Output, sanitizeForTerminal } from "./output";

export type Choice = { value: string; label: string; hint?: string };

// Prompts draw on stderr, so a command that had to ask something still writes
// only its result to stdout.
const output = process.stderr;

// clack writes every text it is given as it is, and a label, a hint or a
// prefilled answer is often a server string. `print` cleans what it writes;
// these are cleaned here, before clack gets them.
const shown = (text: string | undefined) =>
	text === undefined ? undefined : sanitizeForTerminal(text);

const shownChoices = (choices: Choice[]): Choice[] =>
	choices.map((choice) => ({
		value: choice.value,
		label: sanitizeForTerminal(choice.label),
		hint: shown(choice.hint),
	}));

type Cancel = typeof clack.CANCEL_SYMBOL;

// One unwrapper per answer type: `isCancel` removes the cancel symbol from a
// concrete union, but not from a generic `T | symbol`.
const textAnswer = (value: string | Cancel): string => {
	if (clack.isCancel(value)) throw new CancelledError();
	return value;
};

const listAnswer = (value: string[] | Cancel): string[] => {
	if (clack.isCancel(value)) throw new CancelledError();
	return value;
};

const yesNoAnswer = (value: boolean | Cancel): boolean => {
	if (clack.isCancel(value)) throw new CancelledError();
	return value;
};

/** Refuses to ask when nobody can answer, and says what to pass instead. */
export const requireInteractive = (out: Output, instead: string) => {
	if (!out.interactive) throw new UsageError(instead);
};

/** A searchable list. The search is the web app's own: case- and
 *  accent-insensitive, every word anywhere in the label or the hint. */
export const pickOne = async (
	message: string,
	choices: Choice[],
	initialSearch?: string,
): Promise<string> =>
	textAnswer(
		await clack.autocomplete<string>({
			message: sanitizeForTerminal(message),
			options: shownChoices(choices),
			initialUserInput: initialSearch,
			maxItems: 10,
			output,
			filter: (search, option) =>
				matchesSearch(search, [option.label, option.hint]),
		}),
	);

export const pickMany = async (
	message: string,
	choices: Choice[],
): Promise<string[]> =>
	listAnswer(
		await clack.autocompleteMultiselect<string>({
			message: sanitizeForTerminal(message),
			options: shownChoices(choices),
			required: true,
			maxItems: 12,
			output,
			filter: (search, option) =>
				matchesSearch(search, [option.label, option.hint]),
		}),
	);

export const askText = async (
	message: string,
	initialValue?: string,
	placeholder?: string,
	/** Return a sentence to refuse the answer and ask again, in the prompt
	 *  itself. A caller that needs a value gets it here rather than by throwing
	 *  after the person has already typed something. */
	validate?: (value: string | undefined) => string | undefined,
): Promise<string> => {
	const initial = shown(initialValue);
	// clack answers `undefined` for an empty input with no default, whatever
	// its type says, and every caller reads empty as "nothing typed".
	const answer =
		textAnswer(
			await clack.text({
				message: sanitizeForTerminal(message),
				initialValue: initial,
				placeholder: shown(placeholder),
				validate: validate && ((value) => shown(validate(value))),
				output,
			}),
		) ?? "";
	// A prefilled value taken as it stood is the stored one, so a caller that
	// compares the answer with it does not see a change nobody typed.
	return initialValue !== undefined && answer === initial
		? initialValue
		: answer;
};

export const askConfirm = async (message: string): Promise<boolean> =>
	yesNoAnswer(
		await clack.confirm({
			message: sanitizeForTerminal(message),
			initialValue: false,
			output,
		}),
	);

export type Progress = {
	stop: (message: string) => void;
	fail: (message: string) => void;
};

/** A spinner at a terminal; one plain line elsewhere, since a spinner's
 *  redraws would fill a log file with frames. */
export const startProgress = (out: Output, message: string): Progress => {
	if (!out.interactive) {
		process.stderr.write(`${sanitizeForTerminal(message)}\n`);
		return { stop: () => undefined, fail: () => undefined };
	}
	const spin = clack.spinner({ output });
	spin.start(sanitizeForTerminal(message));
	return {
		stop: (text) => spin.stop(sanitizeForTerminal(text)),
		fail: (text) => spin.error(sanitizeForTerminal(text)),
	};
};
