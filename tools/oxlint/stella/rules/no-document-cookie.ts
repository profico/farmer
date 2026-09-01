import { defineRule } from "@oxlint/plugins";

import { isIdentifier, isStringLiteral } from "../utils.ts";

// Forbid assignment to `document.cookie`.
//
// Writing the cookie jar directly bypasses attribute defaults (`Secure`,
// `SameSite`, `Path`) and is easy to get subtly wrong — clobbering unrelated
// cookies by omitting `path`/`domain` on delete, for instance. Route cookie
// writes through a sanctioned cookie utility instead.
//
// Flags:
//   document.cookie = "theme=dark";
//   document.cookie += "; foo=bar";
//   globalThis.document.cookie = value;
//   document["cookie"] = "theme=dark";          // bracket-notation bypass
//
// Allows:
//   const raw = document.cookie;                // reads are fine
//   cookieStore.set("theme", "dark");           // different API entirely

const DOCUMENT_HOSTS = new Set(["document", "globalThis", "window", "self"]);

// True for a computed MemberExpression property that statically resolves to the
// string "cookie": a string literal (`["cookie"]`) or a template literal with no
// interpolations. A dynamic key (`[someVar]`) cannot be proven to target
// `cookie`, so it is not matched.
const isCookieStringValue = (node: unknown): boolean => {
	if (isStringLiteral(node)) {
		return node.value === "cookie";
	}
	if (
		typeof node !== "object" ||
		node === null ||
		(node as { type?: unknown }).type !== "TemplateLiteral"
	) {
		return false;
	}
	const template = node as { quasis?: unknown; expressions?: unknown };
	if (
		!Array.isArray(template.quasis) ||
		!Array.isArray(template.expressions) ||
		template.expressions.length !== 0 ||
		template.quasis.length !== 1
	) {
		return false;
	}
	const quasi = template.quasis[0] as { value?: { cooked?: unknown } };
	return quasi.value?.cooked === "cookie";
};

const isCookieProperty = (property: unknown, computed: boolean): boolean =>
	computed ? isCookieStringValue(property) : isIdentifier(property, "cookie");

// Match `document.cookie`, or `globalThis`/`window`/`self`-prefixed forms, in
// either dot or bracket notation.
const isDocumentCookieAccess = (node: unknown): boolean => {
	if (
		typeof node !== "object" ||
		node === null ||
		(node as { type?: unknown }).type !== "MemberExpression"
	) {
		return false;
	}

	const member = node as {
		computed?: unknown;
		object?: unknown;
		property?: unknown;
	};

	if (!isCookieProperty(member.property, member.computed === true)) {
		return false;
	}

	const object = member.object;
	if (isIdentifier(object, "document")) {
		return true;
	}

	if (
		typeof object !== "object" ||
		object === null ||
		(object as { type?: unknown }).type !== "MemberExpression"
	) {
		return false;
	}
	const outer = object as {
		computed?: unknown;
		object?: unknown;
		property?: unknown;
	};
	return (
		outer.computed === false &&
		isIdentifier(outer.property, "document") &&
		isIdentifier(outer.object) &&
		DOCUMENT_HOSTS.has(outer.object.name)
	);
};

/** Reject direct `document.cookie` writes, which bypass the attribute defaults. */
export const noDocumentCookieRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Reject direct assignment to document.cookie; route cookie writes through a sanctioned utility.",
		},
		messages: {
			noDocumentCookieAssignment:
				"Do not assign to `document.cookie` directly; it bypasses Secure/SameSite/Path defaults and can clobber unrelated cookies. Route cookie writes through a sanctioned cookie utility instead.",
		},
	},
	createOnce(context) {
		return {
			AssignmentExpression(node) {
				if (!isDocumentCookieAccess(node.left)) return;
				context.report({ node, messageId: "noDocumentCookieAssignment" });
			},
		};
	},
});
