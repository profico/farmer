import { defineRule } from "@oxlint/plugins";

import { isIdentifier } from "../utils.ts";

// Ban `<object literal> satisfies Partial<Record<Union, T>>` (with or without a
// leading `as const`).
//
// A const object literal pinned with `satisfies` against a `Record` keyed by a
// union declares itself the classification of every union member — `satisfies`
// fails typecheck the moment a new member is added and left unhandled. Wrapping
// that `Record` in `Partial` cancels the guarantee: a missing member typechecks
// silently, so the literal can drift out of sync with the union with no compiler
// signal.
//
// `Readonly<...>` wrapping either side is unwrapped before the check, since it
// changes mutability, not totality.
//
// Only the `satisfies` expression on an object literal is flagged. Plain
// type-annotation positions (`const x: Partial<Record<...>> = {...}`), function
// parameters, and variable/return type annotations are exempt: those are
// legitimate uses (override inputs, accumulators, genuinely sparse data) and
// carry no compiler guarantee of totality to lose.
//
// Fix by making the record total over the union — an explicit "none" / `false` /
// `null` value for members where nothing applies forces a new union member to be
// classified before it typechecks. If only a subset of the union is ever
// relevant, derive a narrower union for the keys instead of falling back to
// `Partial`.

type TypeNode = { type?: string; typeName?: unknown; typeArguments?: unknown };

const asTypeNode = (value: unknown): TypeNode | null =>
	typeof value === "object" && value !== null ? (value as TypeNode) : null;

const firstTypeArgument = (node: TypeNode): TypeNode | null => {
	const args = node.typeArguments as { params?: unknown } | undefined;
	return Array.isArray(args?.params) ? asTypeNode(args.params[0]) : null;
};

const unwrapReadonlyType = (typeNode: TypeNode | null): TypeNode | null => {
	if (
		typeNode?.type === "TSTypeReference" &&
		isIdentifier(typeNode.typeName, "Readonly")
	) {
		return firstTypeArgument(typeNode);
	}
	return typeNode;
};

// Matches `Partial<Record<...>>`, unwrapping a `Readonly<...>` wrapper on either
// the outer or the inner position.
const isPartialRecordType = (typeNode: unknown): boolean => {
	const outer = unwrapReadonlyType(asTypeNode(typeNode));
	if (
		outer?.type !== "TSTypeReference" ||
		!isIdentifier(outer.typeName, "Partial")
	) {
		return false;
	}
	const inner = unwrapReadonlyType(firstTypeArgument(outer));
	return (
		inner?.type === "TSTypeReference" && isIdentifier(inner.typeName, "Record")
	);
};

// Matches an object literal, or an object literal wrapped in `as const`.
const isObjectLiteralExpression = (node: unknown): boolean => {
	const expression = asTypeNode(node);
	if (expression?.type === "ObjectExpression") {
		return true;
	}
	if (expression?.type !== "TSAsExpression") {
		return false;
	}
	const asExpression = expression as {
		typeAnnotation?: TypeNode;
		expression?: unknown;
	};
	if (
		asExpression.typeAnnotation?.type !== "TSTypeReference" ||
		!isIdentifier(asExpression.typeAnnotation.typeName, "const")
	) {
		return false;
	}
	return isObjectLiteralExpression(asExpression.expression);
};

/** Reject `satisfies Partial<Record<…>>`, which cancels the exhaustiveness check. */
export const noPartialRecordSatisfiesRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Reject satisfies Partial<Record<Union, T>>, which defeats exhaustive companion-map checking.",
		},
		messages: {
			noPartialRecordSatisfies:
				"Don't pin an object literal with `satisfies Partial<Record<...>>` — Partial cancels the totality check satisfies would otherwise give you, so a union member can silently fall through. Make the record total (explicit 'none'/false/null per member), narrow the key union, or suppress with a reason naming what absence means for genuinely sparse data.",
		},
	},
	createOnce(context) {
		return {
			TSSatisfiesExpression(node) {
				if (!isPartialRecordType(node.typeAnnotation)) return;
				if (!isObjectLiteralExpression(node.expression)) return;
				context.report({ node, messageId: "noPartialRecordSatisfies" });
			},
		};
	},
});
