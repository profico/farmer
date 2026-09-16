# 0002 — Repository defaults are ids in `.farmer.jsonc`

**Status:** Accepted
**Date:** 2026-09-15

## Context

Issue #54 asks for a file, tracked in git, that tells the `farmer` CLI and an
agent which project a repository's time goes to, so `farmer log "…" 90min`
works without `-p` and `-t`. The issue's example keys the project by its code:

```json
{ "projectCode": "VINApps", "task": "Frontend" }
```

Without a terminal the CLI refuses a missing `-p` or `-t` rather than opening
the picker, so for an agent the default is what makes the command usable at
all, not a convenience.

The file lands in client repositories this codebase does not control. Once
written, it cannot be migrated: every installed binary must keep reading every
key it ever accepted, the same constraint `src/api/` projections carry.

## Decision

The file is `.farmer.jsonc`, parsed with `Bun.JSONC.parse` and a strict Zod
schema. It holds three keys and nothing else:

```jsonc
{
	"org": "profico", // the organization slug
	"project": "0b6f…", // VINApps
	"task": "9c1d…", // Frontend — optional
}
```

- **`project` and `task` are ids, never codes or names.** A project's `code` is
  optional, is not unique within an organization, and a PM can edit it; a name
  is editable too. A file keyed on either can come to name a different project,
  and the CLI would then log time against the wrong client with no error. An id
  cannot drift onto another row: an archived project or a lost assignment is a
  loud refusal.
- **`org` is the slug.** Every CLI route and the MCP URL take the slug, no route
  finds a project across organizations, and a person in two organizations must
  not have one repository answered from the wrong one.
- **`task` is optional.** The standard engineering tasks are split by platform
  (Frontend, Backend, iOS, …), and a repository is usually one platform, so a
  task is a fact about the repository. A wrong task does not move time to
  another client, which is why it may be a default at all.
- **Every value is a default.** A flag always wins.
- **Only `log` reads `project` and `task`; every command reads `org`.** The
  order for the organization is `--org`, then the file, then `farmer org use`.
  `--org` turns the file off for that command: the file's ids belong to its
  own organization, so its project and task mean nothing in another one.
  `edit` would move an entry nobody asked to move; `file` handles calendar
  meetings, which often belong elsewhere, and with `--remember` would create a
  filing rule nobody chose; `off` takes an absence task, which carries no
  project. `whoami` shows the file's path and the current names behind its ids.
- **A value taken from the file is always announced.** The command writes
  which value it used and from which file (for example
  `Using project VINApps and task Frontend from ../.farmer.jsonc`) with
  `note`, on stderr, so `--json` output stays parseable. A default that
  applies silently is how time lands on a project nobody meant.
- **The nearest file wins, up to the git root.** The CLI walks up from the
  current directory and stops at the first `.farmer.jsonc` or at the directory
  holding `.git` (a directory, or a file in a worktree or submodule). Outside a
  git repository no file applies. Files are never merged, so in a monorepo each
  package's file is complete on its own and repeats `org`. A file above the git
  root — in `~`, say — would be a personal setting under another name.
- **Comments carry the names.** `farmer init` writes the file and puts each
  row's name in a trailing comment, so a reviewer can read what the ids mean.
  The CLI never reads the comments; they go stale on a rename, the ids do not.
- **Unknown keys are refused**, so the file cannot quietly grow a token or a
  per-person setting.

- **A wrong file stops the command; it is never skipped.** A file that does not
  parse, or whose `org` the person is not a member of on this server, stops
  every command that resolves an organization, unless `--org` is given. An
  archived or unusable `project` or `task` stops `log`, unless `-p` or `-t`
  replaces it. Every message names the file and the fix. Falling back to the
  personal default organization instead would put time in the wrong
  organization behind a warning nobody reads — the failure ids exist to
  prevent. `farmer init` never reads the old file, so it can replace a broken
  one.
- **An agent learns the file from the MCP server's `instructions`.** The
  server cannot read a file on the laptop, but the agent can. One paragraph in
  the `instructions` of `routes/api/mcp/$orgSlug.ts` gives the agent the CLI's
  rules: the same search, `project` and `task` as defaults for
  `create_time_entry` only when the person names neither, an announcement of
  what came from which file, and a stop when `org` is not this connection's
  organization. One server change covers every repository, and nothing is
  written into a `CLAUDE.md` or `AGENTS.md` another team owns.
- **An agent can write the file, from the same paragraph.** The `instructions`
  describe the format, and the agent fills it from `list_projects` and
  `list_tasks` and the connection's slug: at the git root (or the package
  directory in a monorepo), no absence task, names in comments, and a question
  before it replaces a file that exists. `list_projects` returns `code` so "use
  VINApps" can be matched. There is no dedicated tool: the assistant and MCP
  share one registry, the web assistant cannot write a file, and the format is
  frozen here, so the two copies (this paragraph and `farmer init`) cannot
  drift. A wrong id is a loud refusal on the next `log`, not a silent one.

## `farmer init`

- Writes at the git root by default, and in the current directory with
  `--here` (a monorepo package). Run in a subdirectory without `--here`, it
  prints the full path before writing, because a file in the wrong subdirectory
  applies only there and nobody notices.
- Refuses outside a git repository, where no file would apply.
- Takes `--org`, `-p` (a name or a code; the id is written) and `-t`; a missing
  value opens the picker, and without a terminal it stops, as `log` does. The
  task picker offers "No default task" (`-t none`) and no absence tasks.
- **Suggests the project from the git remote, and only suggests.** It reads
  `origin`, parses a github.com SSH or HTTPS URL into `owner/name`, and asks
  `GET /api/v1/orgs/$orgSlug/repository-projects?repository=owner/name` for
  the projects the caller may log time on that have a **Linked
  repository** of that name. The matches go first in the picker, marked as
  matching the remote; the person still confirms. Without a terminal a match
  is not taken as `-p`. A missing remote, another host, a renamed repository
  (the name is cached at link time) or a server without the route (a 404)
  means no suggestion and no message. It is a route, not a `repositories` field
  on `ApiProject`, so every `log` does not carry repository names, and an old
  server fails to "no suggestion" rather than to "every project matches".
  `listLinkedRepos` checks only the organization, so the route filters by
  `listMine` itself.
- Asks before replacing a file; `--yes` replaces without asking, as on `rm`.
- Prints the path and a reminder to commit the file.

## Consequences

- Nobody types the file by hand in practice; `farmer init` or an agent writes
  it.
- The CLI's `log` help says that `-p` and `-t` default to `.farmer.jsonc`.
  Help does not show the names: they need a request, and help makes none.
  `farmer whoami` shows them.
- The file never holds a per-person preference. A setting that differs between
  two people in one repository belongs in `~/.config/farmer/config.json`.
- The git remote is never a default at command time, only a suggestion in
  `farmer init`. As a fallback for a repository with no file it would guess
  wrong in a monorepo (one remote, several projects), give no task, and cover
  only repositories an admin connected, to save one `farmer init` per
  repository.
- The term is **Repository defaults** (`CONTEXT.md`). It is not a **Linked
  repository**, which is a server-side GitHub connection.
