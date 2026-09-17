/**
 * Platform admins — the people who operate the deployment, as distinct from
 * the people who administer a workspace inside it.
 *
 * The two are easy to confuse and are not the same column. An org admin is
 * `member.role` — one row per person per organization, granted from Settings →
 * People by anyone who already administers that workspace. A platform admin is
 * `user.role`, one row per person for the whole instance, and nothing in the
 * product can grant it: it comes from `PLATFORM_ADMIN_EMAILS` and from nowhere
 * else. That is the point. The capability it carries is impersonation, which is
 * the ability to become any user in any workspace, so it must not be reachable
 * by anyone who has talked their way into administering one organization.
 *
 * The role string is `platform_admin` rather than better-auth's default
 * `admin` for the same reason — `member.role === "admin"` is already a thing in
 * this codebase, and two columns whose values read identically is a bug waiting
 * for a reader in a hurry.
 *
 * SERVER ONLY. Like `single-org.ts` and `dev-auth.ts`, this reads
 * `process.env`, so in the browser it would answer "nobody is an admin"
 * whatever the server thinks. Screens learn it from the session instead, where
 * better-auth has already put the role.
 *
 * Read per call rather than captured at module scope, matching `mcp-flag.ts`.
 */

/** The value written to `user.role`. See `adminRoles` in `auth/index.ts`. */
export const PLATFORM_ADMIN_ROLE = "platform_admin";

/** better-auth's `defaultRole` — everybody who is not a platform admin. */
export const PLATFORM_USER_ROLE = "user";

/**
 * The configured addresses, lowercased and trimmed.
 *
 * Comma-separated, because that is how every other list-shaped env var in a
 * deployment looks. An empty or unset value means no platform admins at all,
 * which is the right default: a deployment that has not asked for
 * impersonation does not get it.
 */
export const platformAdminEmails = (): ReadonlySet<string> =>
	new Set(
		(process.env.PLATFORM_ADMIN_EMAILS ?? "")
			.split(",")
			.map((email) => email.trim().toLowerCase())
			.filter((email) => email.length > 0),
	);

/**
 * Whether this address operates the deployment.
 *
 * Compared case-insensitively. The address in the env var is typed by an
 * operator; the one on the account comes from Google, which is where this app's
 * identities come from and which does not promise a casing.
 */
export const isPlatformAdminEmail = (email: string): boolean =>
	platformAdminEmails().has(email.trim().toLowerCase());

/**
 * The role a given address should hold, whichever one it holds now.
 *
 * Total rather than partial on purpose: removing an address from
 * `PLATFORM_ADMIN_EMAILS` has to take the role away again, and a function that
 * only ever answers "admin" cannot do that. See the session hook in
 * `auth/index.ts` for when it is applied.
 */
export const platformRoleFor = (email: string): string =>
	isPlatformAdminEmail(email) ? PLATFORM_ADMIN_ROLE : PLATFORM_USER_ROLE;

/** Whether a `user.role` read back from the database is a platform admin. */
export const isPlatformAdminRole = (role: string | null | undefined): boolean =>
	role === PLATFORM_ADMIN_ROLE;
