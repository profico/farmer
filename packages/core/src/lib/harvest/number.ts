// Harvest exports numbers in two locale formats, sometimes in the same
// export: `"10.773,68"` (decimal comma, thousands dot — the time report and
// project list) and `"40.0"` (plain decimal point, no grouping — the people
// list's Capacity column). A value never mixes both separators within one
// number field in the real files, but the parser below tolerates the
// ambiguous case anyway, because a future export is not guaranteed to be as
// clean.
//
// The rule, in order:
//
// 1. Both `,` and `.` appear: the one that occurs LAST in the string is the
//    decimal separator; every other occurrence of either character is a
//    thousands separator and is stripped. This matches both `"10.773,68"`
//    (comma last → decimal comma) and `"10,773.68"` (dot last → decimal
//    point).
// 2. Only `,` appears: look at the digits after the LAST comma.
//    - 1 or 2 trailing digits → decimal comma (`"0,5"`, `"8,25"`, `"40,0"`).
//    - exactly 3 trailing digits, running to the end of the string → a
//      thousands separator with no fractional part (`"10,773"` = 10773).
//      Every comma in the string is stripped on this branch, so
//      `"1,234,567"` also reads as an integer.
//    - anything else (0, or 4+) → decimal comma, since a real thousands
//      group is always exactly 3 digits.
// 3. Only `.` appears: the mirror image, with one difference — a dot
//    followed by exactly 3 digits is only read as thousands grouping when
//    there is MORE THAN ONE dot in the string (`"1.234.567"`). A single dot
//    with 3 trailing digits and nothing else (`"1.234"`) has no grouping
//    evidence, so it is read as a decimal point.
// 4. Neither appears: the whole string is the integer part.
//
// A leading `+` or `-` is preserved. An empty (or whitespace-only) string is
// `null`. A string that still contains a non-digit character after applying
// the rule above is `null` — the caller decides whether that is an error.
export function parseHarvestNumber(raw: string): number | null {
	const trimmed = raw.trim();
	if (trimmed === "") return null;

	let sign = 1;
	let body = trimmed;
	if (body.startsWith("-")) {
		sign = -1;
		body = body.slice(1);
	} else if (body.startsWith("+")) {
		body = body.slice(1);
	}
	if (body === "") return null;

	const split = splitIntegerAndFraction(body);
	if (!split) return null;
	const { integerPart, fractionPart } = split;
	if (!/^\d+$/.test(integerPart)) return null;
	if (fractionPart !== "" && !/^\d+$/.test(fractionPart)) return null;

	const numeric = Number(`${integerPart}.${fractionPart || "0"}`);
	return sign * numeric;
}

interface Split {
	integerPart: string;
	fractionPart: string;
}

function splitIntegerAndFraction(body: string): Split | null {
	const lastComma = body.lastIndexOf(",");
	const lastDot = body.lastIndexOf(".");

	if (lastComma !== -1 && lastDot !== -1) {
		const decimalIsComma = lastComma > lastDot;
		const thousandsChar = decimalIsComma ? "." : ",";
		const decimalChar = decimalIsComma ? "," : ".";
		const cleaned = body.split(thousandsChar).join("");
		const decIndex = cleaned.lastIndexOf(decimalChar);
		return {
			integerPart: cleaned.slice(0, decIndex) || "0",
			fractionPart: cleaned.slice(decIndex + 1),
		};
	}

	if (lastComma !== -1) {
		const trailing = trailingDigitRun(body, lastComma + 1);
		if (trailing.count === 3 && trailing.toEnd) {
			return { integerPart: body.split(",").join(""), fractionPart: "" };
		}
		return {
			integerPart: body.slice(0, lastComma).split(",").join("") || "0",
			fractionPart: body.slice(lastComma + 1),
		};
	}

	if (lastDot !== -1) {
		const trailing = trailingDigitRun(body, lastDot + 1);
		const dotCount = countChar(body, ".");
		if (trailing.count === 3 && trailing.toEnd && dotCount > 1) {
			return { integerPart: body.split(".").join(""), fractionPart: "" };
		}
		return {
			integerPart: body.slice(0, lastDot).split(".").join("") || "0",
			fractionPart: body.slice(lastDot + 1),
		};
	}

	return { integerPart: body, fractionPart: "" };
}

interface TrailingDigitRun {
	count: number;
	toEnd: boolean;
}

function trailingDigitRun(s: string, from: number): TrailingDigitRun {
	let i = from;
	while (i < s.length) {
		const code = s.charCodeAt(i);
		if (code < 48 || code > 57) break;
		i += 1;
	}
	return { count: i - from, toEnd: i === s.length };
}

function countChar(s: string, ch: string): number {
	let count = 0;
	for (let i = 0; i < s.length; i++) if (s[i] === ch) count += 1;
	return count;
}

/** Exact seconds for a decimal hours value, rounded to the nearest second. */
export function hoursToSeconds(hours: number): number {
	return Math.round(hours * 3600);
}

/**
 * Nearest multiple of 900 seconds (15 minutes), with a minimum of 900 —
 * D6's rounding rule. `0` and any value that rounds down to `0` becomes the
 * 15-minute minimum, not zero. Examples: 449 -> 900, 1349 -> 900 (rounds to
 * one 900 s step), 1350 -> 1800 (rounds to two).
 */
export function roundToQuarterHour(seconds: number): number {
	const rounded = Math.round(seconds / 900) * 900;
	return rounded < 900 ? 900 : rounded;
}
