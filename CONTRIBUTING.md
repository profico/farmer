# Contributing

Thank you for your help. This file is short. `CLAUDE.md` is the deep guide
for contributors. Read it before you change a workspace.

## Run it locally

Follow "Run it locally" in the [README](README.md). Then run:

```bash
bun install
bun run setup
bun run dev
```

## Checks

CI runs these commands. Run them before you open a pull request:

```bash
bun run check
bun run typecheck
bun run test
bun run complexity
```

## Commits and pull requests

- Write the commit subject as a conventional commit in the imperative mood,
  for example `fix(web): sort the project list`.
- Keep the subject to 72 characters or fewer.
- Open a pull request against `main`. We merge with squash only.
- Do not put a real client, person, email or production id in a commit, an
  issue or a pull request. Use a placeholder such as `person@example.com`.

## Security

Do not report a vulnerability in a public issue. Read [SECURITY.md](SECURITY.md).

## License of contributions

We have not decided on a contributor license policy yet.
