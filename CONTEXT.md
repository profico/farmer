# Farmer

The vocabulary of this repository. Use these terms as written; do not use the words listed under _Avoid_ for the same concept.

## Language

**Repository defaults**:
A file in a code repository, tracked in git, that gives the `farmer` CLI and an agent the organization, the project and optionally the task to use when a command does not name them. It holds defaults only: a flag always wins. It holds ids, not codes or names, because a code or a name can be changed or repeated and would then point at the wrong project with no error. The file is `.farmer.jsonc`, and `farmer init` writes it. See `docs/adr/0002-repository-defaults-file.md`.
_Avoid_: link, linked project, workspace config

**Linked repository**:
A GitHub repository an admin connected to a project on the server (`projectGithubRepo`). The commit sync reads commits and pull request events from it. Not the same as **Repository defaults**, which are local and set by whoever writes the file.
_Avoid_: repository defaults, project link

**Workspace**:
What the web app calls an organization. Not a synonym for a repository or a directory.

**Server**:
One running farmer deployment, with its own database and its own sign-in methods. Profico runs one, and any operator can run another. The CLI and the **Mobile app** each talk to one server at a time.
_Avoid_: instance (in user-facing text), host, backend

**Server address**:
The origin of a **Server**, for example `https://farmer.example.com`. The CLI reads it from the argument or `FARMER_URL`, and the **Mobile app** asks the person for it. Both check it with `GET /api/v1/meta`.
_Avoid_: instance URL, base URL (in user-facing text)

**Mobile app**:
The native iOS and Android app in `apps/mobile`. It is a client of `api/v1` only, like the CLI, and it never imports `@farmer/core`. See `docs/adr/0005-native-mobile-app.md`.
_Avoid_: PWA, the mobile web view (that is the web app on a phone)

**Push relay**:
The service at `push.farmer.profi.co` (`apps/push-relay`) that holds Profico's APNs and FCM credentials and forwards a push for any **Server**. It cannot read the content. See `docs/adr/0006-push-relay.md`.
_Avoid_: push server, notification proxy

**Relay id**:
The opaque id that the **Push relay** gives one installation of the **Mobile app**. A **Server** sends a push to a relay id, never to an APNs or FCM token.
_Avoid_: push token, device token (those are the APNs and FCM values that only the relay holds)
