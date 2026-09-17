# farmer

A command-line tool to log and read your own time in Farmer.

## Install

Run the install command that your Farmer server shows under Settings →
Integrations:

```sh
# macOS and Linux
curl -fsSL https://farmer.example.com/cli | sh

# Windows (PowerShell)
irm https://farmer.example.com/cli | iex
```

To update, run `farmer update`. It runs the same install script over the
installed binary, so running the install command again does the same.

## Log in

```sh
farmer login https://farmer.example.com
```

The CLI shows a code and opens an approval page in your browser. Approve the
code only if it is the code that your terminal shows. Farmer never asks you for
this code by email or chat. If the browser does not open (for example over
SSH), open the URL that the CLI shows.

Without the argument, the CLI uses `FARMER_URL`, then the last server you used.

The token goes into the system keyring. On a machine with no keyring (a Linux
server with no desktop), the token goes into `credentials.json` next to the
config, with mode 0600. Set `FARMER_NO_KEYRING=1` to skip the keyring.

The config is in `$XDG_CONFIG_HOME/farmer/config.json` (default
`~/.config/farmer/`) on Linux and macOS, and in `%APPDATA%\farmer\` on Windows.

`farmer logout` ends the session on the server and deletes the local token.

## Commands

All commands use today when you give no date.

```
farmer login [url]                  Sign in through the browser
farmer logout                       End the session
farmer whoami                       Your account, organization and timezone
farmer org list                     Your organizations
farmer org use <slug>               Set the default organization
farmer init [-p project] [-t task]  Write .farmer.jsonc for this repository

farmer today                        Today's entries
farmer week [--last]                This week's entries
farmer ls [date] [--from] [--to]    The entries of a day or a range

farmer log <duration | fill> [description] [-p project] [-t task] [-d date] [--overtime]
farmer edit [n | id]                Change an entry
farmer rm [n | id] [--yes]          Delete an entry

farmer start [description] [-p project] [-t task]
farmer pause                        Hold the clock; it measures nothing
farmer resume                       Start measuring again
farmer stop [-m text] [-p project] [-t task] [--duration <d>] [-d date] [--overtime]
farmer timer                        What the timer is measuring
farmer timer discard [--yes]        Throw the measurement away

farmer unfiled [--week]             Worked time with no project
farmer file [ids...] [-p project]   Put unfiled entries on a project
farmer copy day <from> [to]         Copy a day onto another day
farmer copy week [--last]           Copy last week onto this week
farmer off <task> [<from>[..<to>]]  Book time off

farmer projects                     The projects you can log time on
farmer tasks                        The tasks
farmer status                       This week and month against your target
farmer sync                         Run your syncs now
farmer open                         Open your timesheet in the browser
farmer update [url]                 Install the newest release over this one
```

Examples:

```sh
farmer log 1h30m "Review of the login flow" -p web -t development
farmer log fill -p web -t development      # fill the rest of the day
farmer log 2h -d yesterday
farmer edit 2 --duration 45m               # the day's second row
farmer edit 2 --add 1.25                   # 1h15m on top of what it holds
farmer rm 3 -d mon --yes
farmer off vacation 2026-12-22..2027-01-02
farmer start "Checkout form" -p web -t development
farmer pause                               # holds it; farmer resume goes on
farmer stop                                # logs the measured time
farmer today --json | jq '.[].durationSeconds'
```

- Row numbers: the `#` column of `farmer today`, `week` and `ls` numbers the
  entries inside their day, and `farmer edit` and `farmer rm` take that number
  instead of an id. The number belongs to the day, so `farmer edit 2 -d mon`
  changes Monday's second row. It is the row as the list stands now — log or
  delete something and the numbers below it move.
- The timer measures; it does not log. `farmer stop` logs the measured time,
  rounded to the nearest 15 minutes, which is the only duration an entry can
  hold; pass `--duration` to log another one. One timer at a time, in every
  organization and on every machine: start it here and stop it in the browser,
  or the other way round. A timer left running past your limit (Settings →
  Preferences, 12 hours by default) is dropped and logs nothing, and
  `farmer timer` says so.
- `farmer stop` asks what you worked on, with the timer's own note as the
  default, unless you pass `-m`. A task that needs a note says so and asks
  again for an empty answer. Where nobody can answer — a script, a pipe — it
  asks nothing and the server names what is missing.
- `farmer pause` holds the clock and `farmer resume` starts it measuring
  again. A held timer keeps its figure and measures nothing, so it may be held
  for as long as you want and can never be dropped for passing your limit. What
  `farmer stop` logs is the time the timer ran, never the pauses.
- Durations: `1h30m`, `1.5` or `90m`, in 15-minute steps. `farmer edit --add`
  takes the same forms and adds them to the time the entry already holds, so
  a second stretch of work on one task needs no arithmetic.
- Dates: `today`, `yesterday`, a weekday name (the most recent one), or
  `yyyy-MM-dd`, in the timezone of the organization.
- A missing `-p` or `-t` opens a searchable list, unless the repository has
  defaults (below).
- Every command accepts `--json` and `--org <slug>`.
- `farmer help <command>` shows the options of one command.
- The CLI uses no color when `NO_COLOR` is set or stdout is not a terminal.

## Repository defaults

Run `farmer init` in a git repository to write `.farmer.jsonc`, and commit it.
It names the organization, the project and, optionally, the task that time
logged in this repository goes to:

```jsonc
{
	"org": "profico",
	"project": "0b6f2c1e-1f7a-4c3e-9a2b-1d2e3f4a5b6c", // VINApps
	"task": "9c1d4e2f-3a5b-4c6d-8e7f-0a1b2c3d4e5f" // Frontend
}
```

Then `farmer log 90m "Checkout form"` needs no `-p` or `-t`.

- The CLI uses the nearest `.farmer.jsonc` from the current directory up to the
  git root. Outside a git repository, no file applies.
- `farmer log` and `farmer start` use `project` and `task`. Every command uses `org`.
- A flag always wins. `--org` turns the file off for that command.
- Each command says which values it took from the file, on stderr.
- A file that is broken, or names something you cannot use, stops the command.
  Fix the file, or run `farmer init` again.
- `farmer init` writes at the git root; pass `--here` for one package of a
  monorepo. It puts the projects linked to the repository's GitHub remote first
  in the list.
- `farmer whoami` shows the current names behind the ids. The names in the
  comments are only notes.
- `farmer projects` and `farmer tasks` show the ids in their last column, to
  write the file by hand.
- The file holds ids, not project codes, because a code can change or repeat.
  See `docs/adr/0002-repository-defaults-file.md`.

## Do not poll

Do not run `farmer today`, `farmer week` or `farmer ls` under `watch` or in a
loop. When the server reads a day, it recalculates the rest-of-day block of
that day, so each read can write.

## Development

```sh
bun run start -- today      # run from source
bun test                    # the tests
bun run build               # dist/farmer for this machine
bun run build:release       # dist/release/ for every platform, with SHA256SUMS
```
