import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import {
	createTypstCompiler,
	loadFonts,
	type TypstCompiler,
} from "@myriaddreamin/typst.ts";
import { PDF_FONTS_BASE64 } from "./pdf-fonts.gen";

// WASM-backed twin of lib/typst.ts's compileTypstPdf. Compiles the exact same
// typst source with the exact same in-memory Geist fonts and `sys.inputs`, but
// through the platform-independent WebAssembly compiler instead of the native
// NAPI binary — so it runs on serverless/edge (Vercel) where a .node binary
// can't ship. Slower than native (~10-20%) but irrelevant for a single report.
//
// One compiler per process: init loads the 28MB wasm module + parses the fonts,
// which is the expensive part. Guarded by a promise so concurrent first-calls
// share a single init.

const require = createRequire(import.meta.url);

// Resolve the wasm binary shipped inside the web-compiler package, wherever the
// package manager hoisted it, and hand its bytes to the compiler as the module.
const wasmModuleBytes = async (): Promise<Uint8Array> => {
	const wasmPath = require.resolve(
		"@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm",
	);
	return new Uint8Array(await readFile(wasmPath));
};

let compilerPromise: Promise<TypstCompiler> | null = null;

const getCompiler = (): Promise<TypstCompiler> => {
	compilerPromise ??= (async () => {
		const compiler = createTypstCompiler();
		await compiler.init({
			getModule: () => wasmModuleBytes(),
			beforeBuild: [
				// Same Geist blobs as the native path — decoded from the generated
				// base64 module so output is byte-for-byte font-identical.
				loadFonts(
					PDF_FONTS_BASE64.map(
						(b64) => new Uint8Array(Buffer.from(b64, "base64")),
					),
				),
			],
		});
		return compiler;
	})();
	return compilerPromise;
};

const MAIN = "/main.typ";

// The single shared compiler holds one mutable `MAIN` source: addSource() then
// compile() is a non-atomic read-modify-write. Two concurrent callers would race
// — one could overwrite MAIN between the other's addSource and compile, so a
// caller compiles the wrong report. Serialize compiles through a promise chain
// so each addSource+compile pair runs to completion before the next begins.
let compileQueue: Promise<unknown> = Promise.resolve();

export const compileTypstPdfWasm = async (
	mainFileContent: string,
	inputs: Record<string, string> = {},
): Promise<Uint8Array> => {
	const run = compileQueue.then(async () => {
		const compiler = await getCompiler();
		// Register the template as the main source, then compile straight to PDF.
		compiler.addSource(MAIN, mainFileContent);
		const { result, diagnostics } = await compiler.compile({
			mainFilePath: MAIN,
			inputs,
			format: 1, // CompileFormatEnum.pdf
			diagnostics: "full",
		});
		if (!result) {
			throw new Error(
				`typst wasm compile produced no PDF${
					diagnostics ? `: ${JSON.stringify(diagnostics)}` : ""
				}`,
			);
		}
		return result;
	});
	// Keep the queue alive even if this compile rejects, so one failure doesn't
	// wedge every subsequent caller.
	compileQueue = run.catch(() => {});
	return run;
};
