/**
 * Platform admins — the people who operate the deployment, as distinct from
 * the people who administer a workspace inside it.
 *
 * The two are easy to confuse and are not the same column. An org admin is
 * `member.role` — one row per person per organization, granted from Settings →
 * People by anyone who already administers that workspace. A platform admin is
 * `user.role`, one value per person for the whole instance, and it carries
 * impersonation: the ability to become any user in any workspace.
 *
 * **The first account on an instance holds it, and a platform admin grants it
 * to anybody else.** That is Coolify's model and the one issue #75 records for
 * this repository — a person who deploys Farmer should be able to run it
 * without being told to edit an environment variable and restart. The grant
 * itself is a database value, so it survives a redeploy and is not derivable
 * from the environment.
 *
 * Two consequences worth knowing before changing any of this:
 *
 * - **The database is the root of trust, not the deployment's environment.** A
 *   compromised platform admin can promote an accomplice and demote you, and
 *   the way back is SQL against the `user` table. That was the trade made when
 *   the environment variable was dropped.
 * - **An org admin still cannot escalate.** Nothing a workspace's owner can
 *   reach writes this column. Three things do: the admin plugin's own
 *   `user.create.before`, which stamps `defaultRole` on every new account;
 *   `claimPlatformAdmin` in `auth/index.ts`, which upgrades the first one; and
 *   better-auth's `admin/set-role` endpoint, which requires the role it
 *   grants.
 *
 * The role string is `platform_admin` rather than better-auth's default
 * `admin` on purpose — `member.role === "admin"` is already a thing in this
 * codebase, and two columns whose values read identically is a bug waiting for
 * a reader in a hurry.
 *
 * Unlike `single-org.ts` and `dev-auth.ts`, nothing here reads `process.env`,
 * so these are three constants and a comparison and are safe in any process.
 */

/** The value written to `user.role`. See `adminRoles` in `auth/index.ts`. */
export const PLATFORM_ADMIN_ROLE = "platform_admin";

/** better-auth's `defaultRole` — everybody who is not a platform admin. */
export const PLATFORM_USER_ROLE = "user";

/** Whether a `user.role` read back from the database is a platform admin. */
export const isPlatformAdminRole = (role: string | null | undefined): boolean =>
	role === PLATFORM_ADMIN_ROLE;
