# Security policy

## Report a vulnerability

Do not open a public issue for a security problem.

Report it in private:

1. Open the [Security tab](https://github.com/profico/farmer/security) of this repository.
2. Choose "Report a vulnerability".
3. Describe the problem, the steps to repeat it, and the version that you tested.

If you cannot use GitHub, send an email to `security@profi.co`.

We answer a report as soon as we can. We tell you when we fix the problem.
We ask you to keep the report private until we publish a fix.

## Supported versions

We fix security problems in these versions only:

- The latest release.
- The `main` branch.

## Scope

In scope:

- The server (`apps/web` and `packages/core`).
- The command-line tool (`apps/cli`).
- The mobile app (`apps/mobile`).
- The push relay (`apps/push-relay`).

Out of scope:

- A finding that needs a self-hosted instance with a wrong setup.
- A missing rate limit, when the report shows no impact.
- Social engineering of a person who works on the project.
