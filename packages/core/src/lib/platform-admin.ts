/**
 * Platform admins: the people who operate the deployment, not the people who
 * administer a workspace inside it.
 *
 * The two are different columns. An org admin is `member.role`, one row per
 * person per organization, granted from Settings → People by an admin of that
 * workspace. A platform admin is `user.role`, one value per person for the
 * whole instance, and it carries impersonation: the ability to become any user
 * in any workspace.
 *
 * The first account on an instance holds the role, and a platform admin grants
 * it to anybody else (issue #75). The grant is a database value, so it
 * survives a redeploy and does not come from the environment.
 *
 * Two consequences:
 *
 * - The database is the root of trust, not the environment. A compromised
 *   platform admin can promote an accomplice and demote you. The way back is
 *   SQL against the `user` table.
 * - An org admin cannot escalate. Only three things write this column: the
 *   admin plugin's `user.create.before`, which stamps `defaultRole` on each new
 *   account; `claimPlatformAdmin` in `auth/index.ts`, which upgrades the first
 *   one; and better-auth's `admin/set-role`, which requires the role it grants.
 *
 * The role string is `platform_admin`, not better-auth's default `admin`,
 * because `member.role === "admin"` already exists, and two columns with
 * values that read the same invite a mistake.
 *
 * Unlike `single-org.ts` and `dev-auth.ts`, nothing here reads `process.env`,
 * so these constants are safe in any process.
 */

/** The value written to `user.role`. See `adminRoles` in `auth/index.ts`. */
export const PLATFORM_ADMIN_ROLE = "platform_admin";

/** better-auth's `defaultRole` — everybody who is not a platform admin. */
export const PLATFORM_USER_ROLE = "user";

/** Whether a `user.role` read back from the database is a platform admin. */
export const isPlatformAdminRole = (role: string | null | undefined): boolean =>
	role === PLATFORM_ADMIN_ROLE;
