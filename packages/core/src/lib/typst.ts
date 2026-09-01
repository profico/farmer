import { NodeCompiler } from "@myriaddreamin/typst-ts-node-compiler";

import { PDF_FONTS_BASE64 } from "./pdf-fonts.gen";

// One compiler per process — creation loads fonts, which is the expensive
// part. Geist/Geist Mono are fed in as in-memory blobs so output is identical
// on every machine regardless of installed fonts. Compile-time data goes
// through per-call `inputs` (sys.inputs), and evictCache keeps the
// incremental-compilation memoizer from growing unboundedly across requests.
let compiler: NodeCompiler | null = null;
const getCompiler = (): NodeCompiler => {
	compiler ??= NodeCompiler.create({
		fontArgs: [
			{
				fontBlobs: PDF_FONTS_BASE64.map((b64) => Buffer.from(b64, "base64")),
			},
		],
	});
	return compiler;
};

export const compileTypstPdf = (
	mainFileContent: string,
	inputs: Record<string, string> = {},
): Buffer => {
	const instance = getCompiler();
	try {
		return instance.pdf({ mainFileContent, inputs });
	} finally {
		instance.evictCache(10);
	}
};
