import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

// Suppression hygiene — keeps disable directives honest so the codebase does not
// re-accumulate undocumented or dead ones.
//
//   require-description — every `oxlint-disable` / `eslint-disable` directive
//     must explain itself, either with an inline `-- <reason>` trailer or a
//     comment on the line directly above (the `// SAFETY:` convention this repo
//     already uses for `as` casts). Catches bare directives that silence a rule
//     with no rationale.
//
//   no-foreign-directive — bans `biome-ignore` / `prettier-ignore` comments.
//     The toolchain is oxlint + oxfmt; biome is not installed, so its directives
//     are dead comments that look like live suppressions.
//
// `@ts-ignore` / `@ts-expect-error` hygiene is a separate concern, owned by the
// native `typescript/ban-ts-comment` rule.
//
// Flagged:
//   // oxlint-disable-next-line typescript/no-explicit-any
//   // biome-ignore lint/a11y/noStaticElementInteractions: ...
// Allowed:
//   // oxlint-disable-next-line no-console -- dev-only CLI output
//   // SAFETY: url validated as http/https
//   // oxlint-disable-next-line anti-slop/no-runtime-typeof

const DISABLE_RE = /\b(?:eslint|oxlint)-disable(?:-next-line|-line)?\b/u;
const ENABLE_RE = /\b(?:eslint|oxlint)-enable\b/u;
const INLINE_DESCRIPTION_RE = /--\s*\S/u;
const FOREIGN_RE = /\b(?:biome-ignore|prettier-ignore)\b/u;

const isDirective = (text: string): boolean =>
	DISABLE_RE.test(text) || ENABLE_RE.test(text);

/** Require every lint-suppression directive to carry a reason. */
export const requireSuppressionDescriptionRule = defineRule({
	meta: {
		type: "suggestion",
		docs: {
			description:
				"Require a reason on every lint suppression directive, inline or on the line above.",
		},
		messages: {
			requireDescription:
				"Suppression directive needs a reason: add a `-- <why>` trailer, or a comment on the line directly above explaining why the rule is suppressed here.",
		},
	},
	createOnce(context) {
		return {
			Program(node: ESTree.Program) {
				const { comments } = node;
				for (const comment of comments) {
					if (!DISABLE_RE.test(comment.value)) continue;
					if (INLINE_DESCRIPTION_RE.test(comment.value)) continue;
					const lineAbove = comment.loc.start.line - 1;
					// A prose comment immediately above is the other accepted spelling —
					// it is what a multi-paragraph justification has to look like, since
					// the directive itself must stay the last line of the block.
					const documentedAbove = comments.some(
						(other) =>
							other !== comment &&
							!isDirective(other.value) &&
							other.loc.end.line === lineAbove,
					);
					if (documentedAbove) continue;
					context.report({ node: comment, messageId: "requireDescription" });
				}
			},
		};
	},
});

/** Reject suppression directives aimed at a linter this repo does not run. */
export const noForeignDirectiveRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Reject biome-ignore / prettier-ignore comments; neither tool runs here, so the directive is dead.",
		},
		messages: {
			noForeignDirective:
				"`{{kind}}` is not honoured by this toolchain (oxlint + oxfmt). Remove it; use an oxlint disable directive instead.",
		},
	},
	createOnce(context) {
		return {
			Program(node: ESTree.Program) {
				for (const comment of node.comments) {
					const match = FOREIGN_RE.exec(comment.value);
					if (match) {
						context.report({
							node: comment,
							messageId: "noForeignDirective",
							data: { kind: match[0] },
						});
					}
				}
			},
		};
	},
});
