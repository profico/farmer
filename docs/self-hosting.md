# Self-hosting

This guide shows how to run Farmer on your own server with Compose. It also shows how to upgrade and how to make a backup. The environment reference is in `docs/domains/deployment.md`.

You need a Linux server with `podman compose` or `docker compose`, and a reverse proxy that ends TLS.

## Quick start

1. Copy the files from the `deploy/` folder to the server.
2. Copy `.env.example` to `.env` in the same folder.
3. Set `POSTGRES_PASSWORD`, `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` in `.env`. Make the secret with `openssl rand -hex 32`.
4. Start the services: `podman compose -f compose.yml up -d`.
5. Open the address that you set in `BETTER_AUTH_URL`. The first account that you create is the platform admin.
6. Set up email, sign-in and uploads on the Infrastructure pages (Settings, Infrastructure).

The `farmer` service applies the database migrations and seeds the built-in tasks each time it starts. Then it starts the server. Compose waits for the database to be healthy before it starts `farmer`.

To build the image from a checkout of the repository, use the `build` block in `compose.yml` in place of `image`.

Keep `BETTER_AUTH_SECRET`. The server uses it to seal each stored secret. A new value makes these secrets unreadable. To rotate it, read "Rotate the secret" in `docs/domains/deployment.md`.

### Required variables

The production server and the standalone worker (`bun run worker`) check three variables when they start: `DATABASE_URL`, `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL`. If one is missing or empty, the process prints one message that names each missing variable, and exits with code 1. A weak value gives a warning only: a secret with fewer than 32 characters, or a `BETTER_AUTH_URL` that is not a URL. The check runs only when `NODE_ENV=production`, which the image sets.

## Reverse proxy

The compose file publishes the port on `127.0.0.1` only. Put a reverse proxy (for example Caddy, nginx or Traefik) on the same host. The proxy ends TLS and passes the requests to `http://127.0.0.1:3000`. Pass the `Host` header and the WebSocket and streaming headers unchanged. Do not set a short read timeout: the assistant streams long answers.

Set `BETTER_AUTH_URL` to the public origin, for example `https://farmer.example.com`. The server builds each sign-in callback URL from it.

The rate limits use the client address. By default the server reads the socket address, which is the address of the proxy. Set `TRUSTED_IP_HEADER` to the header that your proxy writes (`x-forwarded-for`, `x-real-ip` or `cf-connecting-ip`). Use a header that the proxy always overwrites. Keep the port closed to all other callers, or a caller can set the header. See "The client address is read from one header" in `docs/domains/deployment.md`.

## Image tags

The image is `ghcr.io/profico/farmer`. Set `FARMER_VERSION` in `.env` to one of these tags:

| Tag | Meaning |
|---|---|
| `X.Y.Z` (for example `1.2.3`) | One release. It never changes. |
| `X.Y` (for example `1.2`) | The newest patch release of a minor version. |
| `X` (for example `1`) | The newest release of a major version. |
| `latest` | The newest release. It does not move on a push to `main`. |
| `nightly` | The newest build of `main`. It can contain a change that is not released. |

Each tag has an `amd64` image and an `arm64` image. For a production server, use `X.Y.Z` or `X.Y`, so that an upgrade is a decision that you make. A pre-release tag (for example `1.2.3-rc.1`) is its own tag only.

## Upgrade

1. Read the release notes of each release between your version and the new one. Look for a breaking change.
2. Make a backup (see "Backup"). Do not skip this step.
3. Set the new tag in `FARMER_VERSION`.
4. Pull the image and restart:

```sh
podman compose -f compose.yml pull farmer
podman compose -f compose.yml up -d
```

5. Look at the log: `podman compose -f compose.yml logs -f farmer`. Wait for the line "Server listening".

The entrypoint applies the new migrations when the container starts. The migrator takes a Postgres advisory lock, so two containers that start together do not run the same migration twice.

A downgrade is not supported. A migration can change the schema in a way that an older version cannot read. To go back, stop the services, restore the backup that you made in step 2 (see "Restore"), and set the old tag.

## Backup

A backup has two parts: the database and the upload store.

### Database

The `postgres-data` volume holds everything except the uploaded images. Make a dump with `pg_dump` from the running service:

```sh
podman compose -f compose.yml exec -T postgres \
  pg_dump -U farmer -d farmer --format=custom > farmer-$(date +%F).dump
```

Copy the file to a different machine. Test the restore one time, before you need it.

### Restore

Stop `farmer`, make an empty database, and load the dump:

```sh
podman compose -f compose.yml stop farmer
podman compose -f compose.yml exec -T postgres \
  dropdb -U farmer --if-exists farmer
podman compose -f compose.yml exec -T postgres \
  createdb -U farmer farmer
podman compose -f compose.yml exec -T postgres \
  pg_restore -U farmer -d farmer --no-owner < farmer-2026-01-01.dump
podman compose -f compose.yml up -d
```

Use the same `BETTER_AUTH_SECRET` as the one that was in use when you made the dump. A different secret makes the stored secrets unreadable.

### Uploads

Project icons and organization logos are in the S3-compatible bucket that you set on the Infrastructure pages (see `docs/domains/uploads.md`). They are not in the dump. Copy the bucket with the tool of your store, for example `rclone sync` or `aws s3 sync`.

### Secrets

Keep a copy of `.env`, outside the server. Without `BETTER_AUTH_SECRET`, a restored database cannot open its stored secrets.

## Versions of the mobile app and the CLI

The server and its clients are released separately. Each client asks `GET /api/v1/meta` (no sign-in needed) when it connects. The answer has these fields:

- `serverVersion`: the release of the server (`null` for a `nightly` image).
- `apiVersion`: the version of the API.
- `minCliVersion`: the oldest CLI that this server supports.
- `minMobileVersion`: the oldest mobile app that this server supports.

The CLI and the mobile app compare their own version with the minimum. If a client is older, the server does not support it, and the user must update it. The maintainers raise the minimum only when a change breaks old clients. When you upgrade the server, check the release notes for a new minimum, and tell the users to update their apps. Use a client release that is not older than the minimum of your server.

## Background jobs

The server runs the background jobs in its own process (reminders, sweeps and webhook delivery). Run one instance of the server, or split the jobs into one worker as described in `docs/domains/deployment.md`. Do not scale the `farmer` service to more than one container.
