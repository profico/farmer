import { defineConfig } from "oxlint";

export default defineConfig({
	ignorePatterns: [
		".claude/**",
		"tools/oxlint/**",
		"**/routeTree.gen.ts",
		"**/src/db/schema/auth.ts",
		"**/src/lib/pdf-fonts.gen.ts",
		"**/dist/**",
	],
	plugins: ["react", "react-hooks", "jsx-a11y", "typescript", "oxc", "import"],
	categories: { correctness: "error" },
	jsPlugins: [
		{ name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" },
		{ name: "stella", specifier: "./tools/oxlint/stella/index.ts" },
	],
	rules: {
		// React 19's automatic JSX runtime — `React` is never in scope by design.
		"react/react-in-jsx-scope": "off",
		// Rules the codebase carries documented suppressions for; they are not in
		// oxlint's `correctness` set, so they have to be named to stay live.
		"react/no-array-index-key": "warn",
		"react/no-danger": "warn",
		"typescript/no-non-null-assertion": "warn",
		// Labels in this codebase wrap their text in a nested <span> for
		// truncation, which is one level past the rule's default depth of 2.
		"jsx-a11y/label-has-associated-control": ["error", { depth: 4 }],

		// Pre-existing findings biome's ruleset never reported. They are real, but
		// fixing them is UI work, not a lint migration — so they land visible and
		// non-blocking rather than being switched off. Promote to "error" as each
		// is burned down.
		"react/set-state-in-effect": "warn",
		"react/refs": "warn",
		"react/incompatible-library": "warn",
		"jsx-a11y/no-autofocus": "warn",
		"jsx-a11y/control-has-associated-label": "warn",
		"jsx-a11y/interactive-supports-focus": "warn",

		"anti-slop/no-chained-type-assertions": "error",
		"anti-slop/no-conditional-empty-object-spread": "error",
		"anti-slop/no-known-value-widening": "error",
		"anti-slop/no-module-mocking": "error",
		"anti-slop/no-object-parameters": "error",
		"anti-slop/no-reflect-apply": "error",
		"anti-slop/no-reflect-get": "error",
		"anti-slop/no-runtime-typeof": "error",
		"anti-slop/no-shape-in-symbol-names": "error",
		"anti-slop/no-unknown-parameters": "error",
		"anti-slop/no-unknown-returns": "error",
		"anti-slop/no-unknown-type-aliases": "error",
		"anti-slop/no-unsafe-dictionary-type": "error",
		"anti-slop/no-widen-then-assert": "error",
		"anti-slop/require-safety-comment-for-type-assertion": "error",

		// Vendored from stella (see tools/oxlint/stella/index.ts). Each of these
		// guards an invariant this repo already held with nothing enforcing it.
		"stella/no-document-cookie": "error",
		"stella/no-foreign-directive": "error",
		"stella/no-partial-record-satisfies": "error",
		"stella/no-vacuous-throw-assertion": "error",
		"stella/require-suppression-description": "error",
	},
});
