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

farmer today                        Today's entries
farmer week [--last]                This week's entries
farmer ls [date] [--from] [--to]    The entries of a day or a range

farmer log <duration | fill> [description] [-p project] [-t task] [-d date] [--overtime]
farmer edit [id]                    Change an entry
farmer rm [id] [--yes]              Delete an entry

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
farmer off vacation 2026-12-22..2027-01-02
farmer today --json | jq '.[].durationSeconds'
```

- Durations: `1h30m`, `1.5` or `90m`, in 15-minute steps.
- Dates: `today`, `yesterday`, a weekday name (the most recent one), or
  `yyyy-MM-dd`, in the timezone of the organization.
- A missing `-p` or `-t` opens a searchable list.
- Every command accepts `--json` and `--org <slug>`.
- `farmer help <command>` shows the options of one command.
- The CLI uses no colour when `NO_COLOR` is set or stdout is not a terminal.

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
