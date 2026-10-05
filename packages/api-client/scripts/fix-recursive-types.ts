/**
 * `openapi-typescript` writes a recursive schema such as `JsonValue` as a
 * property that names itself, and `tsc` refuses that (TS2502). This rewrites
 * the property to point at a top-level type alias, which TypeScript allows to
 * recurse.
 */
const path = process.argv[2] ?? "./src/openapi.gen.ts";
const source = await Bun.file(path).text();

const property =
	/ {8}JsonValue: string \| number \| boolean \| null \| components\["schemas"\]\["JsonValue"\]\[\] \| \{\n {12}\[key: string\]: components\["schemas"\]\["JsonValue"\];\n {8}\};\n/;

if (!property.test(source)) {
	console.log("No recursive JsonValue property to rewrite.");
	process.exit(0);
}

const alias = `
/** Any JSON value. A top-level alias, because a self-naming property fails TS2502. */
export type JsonValue =
	| string
	| number
	| boolean
	| null
	| JsonValue[]
	| { [key: string]: JsonValue };
`;

await Bun.write(
	path,
	source.replace(property, "        JsonValue: JsonValue;\n") + alias,
);
console.log("Rewrote the recursive JsonValue property.");
