import { eslintCompatPlugin } from "@oxlint/plugins";

import { noDocumentCookieRule } from "./rules/no-document-cookie.ts";
import { noPartialRecordSatisfiesRule } from "./rules/no-partial-record-satisfies.ts";
import { noVacuousThrowAssertionRule } from "./rules/no-vacuous-throw-assertion.ts";
import {
	noForeignDirectiveRule,
	requireSuppressionDescriptionRule,
} from "./rules/suppression-hygiene.ts";

/**
 * Four rules vendored from stella's `.oxlint-plugins` (Apache-2.0), kept because
 * each one guards an invariant this repo already holds by convention and had no
 * way to keep holding. Provenance stays visible so a future re-sync is a diff:
 * https://github.com/stella/stella/tree/main/.oxlint-plugins
 *
 * The other ~126 rules there are either stella-domain, aimed at a stack this repo
 * does not run, or already covered by anti-slop and the native rule set.
 */
const stellaPlugin = eslintCompatPlugin({
	meta: { name: "stella" },
	rules: {
		"no-document-cookie": noDocumentCookieRule,
		"no-foreign-directive": noForeignDirectiveRule,
		"no-partial-record-satisfies": noPartialRecordSatisfiesRule,
		"no-vacuous-throw-assertion": noVacuousThrowAssertionRule,
		"require-suppression-description": requireSuppressionDescriptionRule,
	},
});

export default stellaPlugin;
