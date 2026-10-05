import { defineConfig } from "oxlint";

export default defineConfig({
	ignorePatterns: [
		".claude/**",
		"tools/oxlint/**",
		"**/routeTree.gen.ts",
		"**/src/db/schema/auth.ts",
		"**/dist/**",
		"apps/mobile/android/**",
		"apps/mobile/ios/**",
		"apps/mobile/.expo/**",
		"packages/api-client/src/openapi.gen.ts",
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
	overrides: [
		{
			// The mobile app and its API client are clients of `api/v1` only
			// (ADR 0005). Unlike the CLI they take nothing from the server, not
			// even types: a store build outlives the server it was built against,
			// so the shapes it reads are its own, parsed at the boundary.
			files: ["apps/mobile/**", "packages/api-client/**"],
			rules: {
				"no-restricted-imports": [
					"error",
					{
						patterns: [
							{
								group: [
									"@farmer/core",
									"@farmer/core/**",
									"**/packages/core/**",
								],
								message:
									"The mobile app and the API client talk to the server only through api/v1. Declare the shape in @farmer/api-client.",
							},
							{
								group: ["web", "web/**", "**/apps/web/**", "\\#/**"],
								message:
									"The mobile app and the API client must not import the web app.",
							},
						],
					},
				],
			},
		},
		{
			// The CLI compiles into a binary that people download, so a runtime
			// import of the server graph would ship the database driver, the auth
			// config and every service inside it. It may use the modules that are
			// safe without a database: the request schemas, the time helpers, the
			// shared search, and the API response types. `import type` from
			// anywhere is erased at build time, so it stays allowed.
			files: ["apps/cli/**"],
			rules: {
				"no-restricted-imports": [
					"error",
					{
						patterns: [
							{
								group: [
									"@farmer/core/**",
									"!@farmer/core/api",
									"!@farmer/core/schema",
									"!@farmer/core/lib/time",
									"!@farmer/core/lib/search",
								],
								allowTypeImports: true,
								message:
									"The CLI binary must not contain the server. At runtime it may import only @farmer/core/api, /schema, /lib/time and /lib/search; use `import type` for anything else.",
							},
							{
								group: ["**/packages/core/**"],
								allowTypeImports: true,
								message: "Import @farmer/core through its package exports.",
							},
						],
					},
				],
			},
		},
	],
});
