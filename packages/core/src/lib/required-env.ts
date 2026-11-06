/**
 * The environment variables that a production process cannot start without.
 *
 * Call `requireProductionEnv` from a production entry point only
 * (`apps/web/server.ts` and `jobs/worker.ts`), never at module import time:
 * `vite build` runs in the Dockerfile with no environment at all.
 *
 * A missing value stops the process. A weak value only gives a warning,
 * because a running deployment may have it today.
 */
export const REQUIRED_ENV = [
	"DATABASE_URL",
	"BETTER_AUTH_SECRET",
	"BETTER_AUTH_URL",
] as const;

const MIN_SECRET_LENGTH = 32;

type Env = Record<string, string | undefined>;

export interface EnvCheck {
	/** The names that are unset or empty. An empty value counts as unset. */
	missing: string[];
	warnings: string[];
}

const isUrl = (value: string): boolean => {
	try {
		new URL(value);
		return true;
	} catch {
		return false;
	}
};

export const checkRequiredEnv = (env: Env): EnvCheck => {
	const missing = REQUIRED_ENV.filter((name) => !env[name]?.trim());
	const warnings: string[] = [];
	const secret = env.BETTER_AUTH_SECRET?.trim();
	if (secret && secret.length < MIN_SECRET_LENGTH) {
		warnings.push(
			`BETTER_AUTH_SECRET has fewer than ${String(MIN_SECRET_LENGTH)} characters. Use "openssl rand -hex 32".`,
		);
	}
	const origin = env.BETTER_AUTH_URL?.trim();
	if (origin && !isUrl(origin)) {
		warnings.push(
			"BETTER_AUTH_URL is not a URL. Use the public origin, for example https://farmer.example.com.",
		);
	}
	return { missing, warnings };
};

interface Sink {
	error: (line: string) => void;
	warn: (line: string) => void;
}

/**
 * Under `NODE_ENV=production`: print every warning, then print one message
 * that names every missing variable and exit with code 1. Else do nothing.
 */
export const requireProductionEnv = (
	sink: Sink = { error: console.error, warn: console.warn },
	env: Env = process.env,
): void => {
	if (env.NODE_ENV !== "production") return;
	const { missing, warnings } = checkRequiredEnv(env);
	for (const line of warnings) sink.warn(line);
	if (missing.length === 0) return;
	sink.error(
		`Missing required environment variables: ${missing.join(", ")}. Set them and start again. See docs/self-hosting.md.`,
	);
	process.exit(1);
};
