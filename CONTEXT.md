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
