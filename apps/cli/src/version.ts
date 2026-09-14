import packageJson from "../package.json";

/**
 * The version this binary reports to the server and to `farmer --version`.
 *
 * Read from `package.json`, which the bundler inlines into the compiled
 * binary, so the release has one number to bump and the binary cannot report a
 * different one from the package it was built from.
 */
export const CLI_VERSION: string = packageJson.version;
