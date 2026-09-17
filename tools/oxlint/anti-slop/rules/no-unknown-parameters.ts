import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

import {
  containsUnknownType,
  functionParameterBindingName,
  functionParameterTypeAnnotation,
} from "../shared/function-parameters.ts";
type ParameterOwner =
  | ESTree.ArrowFunctionExpression
  | ESTree.Function
  | ESTree.TSCallSignatureDeclaration
  | ESTree.TSConstructSignatureDeclaration
  | ESTree.TSConstructorType
  | ESTree.TSFunctionType
  | ESTree.TSMethodSignature;

function isTypePredicateSubject(owner: ParameterOwner, parameterName: string): boolean {
  const predicate = owner.returnType?.typeAnnotation;
  return (
    predicate?.type === "TSTypePredicate" &&
    predicate.parameterName.type === "Identifier" &&
    predicate.parameterName.name === parameterName
  );
}

/** Disallow unknown inputs except explicitly named error-cause enrichment. */
export const noUnknownParametersRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow explicitly unknown function parameters except `cause` and type-predicate subjects; decode unknown input at its I/O boundary instead.",
    },
    messages: {
      unknownParameter:
        "Parameter `{{parameter}}` leaves input unparsed. Accept a named domain type; run the expected schema or parser at the I/O boundary before calling this function.",
    },
  },
  createOnce(context) {
    // Local amendment to the upstream rule. A promise rejection handler's
    // parameter is `unknown` because TypeScript makes it so (`useUnknownIn-
    // CatchVariables`), not because a boundary went unparsed: there is no
    // schema for "whatever was thrown". It is the same case the upstream
    // `cause` exception already carves out, reached through `.catch()` rather
    // than through an Error option bag, so it is spelled the same way.
    const isRejectionHandler = (node: ParameterOwner): boolean => {
      const parent = node.parent;
      if (parent?.type !== "CallExpression") return false;
      const callee = parent.callee;
      if (callee.type !== "MemberExpression" || callee.computed) return false;
      const method = callee.property;
      if (method.type !== "Identifier") return false;
      if (method.name === "catch") return parent.arguments[0] === node;
      if (method.name === "then") return parent.arguments[1] === node;
      return false;
    };

    const checkParameters = (node: ParameterOwner) => {
      if (isRejectionHandler(node)) return;
      for (const parameter of node.params) {
        const annotation = functionParameterTypeAnnotation(parameter);
        if (annotation === null || annotation === undefined) continue;
        if (!containsUnknownType(annotation.typeAnnotation)) continue;
        const name = functionParameterBindingName(parameter, context.sourceCode);
        if (name === "cause" || isTypePredicateSubject(node, name)) continue;
        context.report({
          node: annotation.typeAnnotation,
          messageId: "unknownParameter",
          data: { parameter: name },
        });
      }
    };

    return {
      ArrowFunctionExpression: checkParameters,
      FunctionDeclaration: checkParameters,
      FunctionExpression: checkParameters,
      TSCallSignatureDeclaration: checkParameters,
      TSConstructSignatureDeclaration: checkParameters,
      TSConstructorType: checkParameters,
      TSDeclareFunction: checkParameters,
      TSEmptyBodyFunctionExpression: checkParameters,
      TSFunctionType: checkParameters,
      TSMethodSignature: checkParameters,
    };
  },
});
