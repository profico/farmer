// Shared AST helpers for the rules in this folder.
//
// Oxlint plugin AST nodes are passed in untyped. Each helper narrows from
// `unknown` so rule files can call them without per-call type ceremony or
// shared type-import boilerplate.

import type { Ranged } from "@oxlint/plugins";

export type AstNode = Ranged & { type: string } & Record<string, unknown>;

export const isAstNode = (node: unknown): node is AstNode =>
	typeof node === "object" &&
	node !== null &&
	"type" in node &&
	typeof (node as { type: unknown }).type === "string" &&
	"range" in node;

export const isIdentifier = (
	node: unknown,
	name?: string,
): node is AstNode & { type: "Identifier"; name: string } => {
	if (!isAstNode(node) || node.type !== "Identifier") {
		return false;
	}
	if (typeof node.name !== "string") {
		return false;
	}
	return name === undefined || node.name === name;
};

export const isStringLiteral = (
	node: unknown,
): node is AstNode & { type: "Literal"; value: string } =>
	isAstNode(node) && node.type === "Literal" && typeof node.value === "string";

/** Resolve the static name of a Property or MemberExpression key: Identifier.name
 *  or string-Literal.value. Null for computed keys driven by a non-literal. */
export const getPropertyName = (node: unknown): string | null => {
	if (isIdentifier(node)) {
		return node.name;
	}
	if (isStringLiteral(node)) {
		return node.value;
	}
	return null;
};

/** Match a `CallExpression` whose callee is an Identifier with the given name. */
export const isCallTo = (node: unknown, name: string): boolean =>
	isAstNode(node) &&
	node.type === "CallExpression" &&
	isIdentifier(node.callee, name);
