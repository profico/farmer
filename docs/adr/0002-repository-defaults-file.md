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

## Consequences

- Nobody types the file by hand in practice; `farmer init` is the way in.
- The CLI's `log` help shows each default and where it came from.
- The file never holds a per-person preference. A setting that differs between
  two people in one repository belongs in `~/.config/farmer/config.json`.
- The term is **Repository defaults** (`CONTEXT.md`). It is not a **Linked
  repository**, which is a server-side GitHub connection.
