# Spectacles

A small, open-source CLI for creating and tracking work in OpenSpec-style Markdown. No account, database, or runtime dependencies needed for local use. It writes familiar `openspec/changes/` files, but is not a replacement for the full OpenSpec toolchain. Linear and Jira are **not** connected by the built-in adapter.

Requires Node.js 20 or newer. Run directly from the repository root:

`app/cli.js` is the entry point; `app/work.js` handles local Markdown tasks, `app/task-view.js` formats task trees and progress, `app/adapters/` contains the adapter loader and built-in Markdown adapter, and `app/integrations/` contains image handling, screen capture, and explicit GitHub commands. Repository agent guidance lives in `AGENTS.md` and optional Copilot hooks and skills in `.github/`.

```sh
node app/cli.js new "Improve onboarding"
node app/cli.js add improve-onboarding "Write the onboarding proposal"
node app/cli.js add improve-onboarding "Implement the welcome screen"
node app/cli.js subtask improve-onboarding 2 "Capture the welcome screen"
node app/cli.js screenshot improve-onboarding 2.1 ./welcome.png
node app/cli.js show improve-onboarding
node app/cli.js done improve-onboarding 1 "Proposal reviewed and approved"
node app/cli.js list
```

Or run `npm link` once to use `spectacles` instead of `node app/cli.js`. Run `node app/cli.js help` for all commands.

Each change lives in `openspec/changes/<slug>/`, with a `proposal.md` for the why and what, a `tasks.md` with Markdown checkboxes, and optional `screenshots/` image evidence. The CLI creates the folder on `new`; fill in the proposal yourself. Task IDs shown by `show` (e.g. `1`, `1.1`) are accepted by `done`, `subtask`, and `screenshot`. Every completion requires a one-line resolution and all descendants must be done before their parent. Screenshot images are copied locally, with links in `tasks.md`; files can still be edited by hand.

To capture the primary display rather than attach a file, omit the image argument: `node app/cli.js screenshot improve-onboarding 2.1`. macOS uses `screencapture`, Windows uses PowerShell's desktop capture, and Linux tries `grim`, `gnome-screenshot`, then `scrot`. Capture needs access to the graphical session and OS screen-recording permission. Nothing is uploaded. Obtain permission before capturing another person's screen, and review images for sensitive information before sharing or committing them.

Any agent can read [AGENTS.md](AGENTS.md) or call the CLI. Copilot can additionally use the optional `.github/skills/spectacles-work/SKILL.md` and `.github/hooks/spectacles.json` session-start hook. The hook supplies a short summary of local work to Copilot CLI and cloud agent, but the CLI does not depend on Copilot.

## GitHub issues and Projects v2

Explicit GitHub commands use your existing `gh auth login` credentials and require the relevant repository and `project` permissions:

```sh
node app/cli.js github issue new owner/repo "Fix onboarding" "Describe the problem"
node app/cli.js github issue edit owner/repo 42 --body "Updated description"
node app/cli.js github project new owner "Q4 roadmap"
node app/cli.js github project edit owner 3 --description "Prioritized work"
node app/cli.js github project add owner 3 https://github.com/owner/repo/issues/42
node app/cli.js github project status owner 3 https://github.com/owner/repo/issues/42 "In Progress"
```

Use `--title` in place of `--body` or `--description` to change titles. Project status values must already exist as options in the board's **Status** field. If needed, authorize with `gh auth refresh -s project`. Commands are noninteractive and surface `gh` failures. They do **not** automatically sync issues, projects, or screenshots to local changes or to one another.

## Extend with adapters

The default `markdown` adapter needs no configuration. For other backends, install a trusted adapter package in **your project** and opt in via `.spectacles.json`:

```json
{
  "adapters": {
    "team": {
      "package": "@your-org/spectacles-adapter",
      "options": { "project": "EXAMPLE" }
    }
  }
}
```

Run `spectacles --adapter team list` (or `node app/cli.js --adapter team list`). Add `"defaultAdapter": "team"` to the config if you want every command to use it by default. The CLI resolves packages from the current project and will not load arbitrary file paths or an unconfigured plugin. The adapter contract, example implementation, and deployment guidance are in [docs/adapters.md](docs/adapters.md).

For enterprise deployment, review and pin adapter packages, protect changes to `.spectacles.json`, and use your normal secret manager/environment for credentials—never commit credentials in the config. Plugins execute with the user's privileges and are responsible for their own authentication, permissions, retries, and remote error reporting. The Copilot session hook reads only local Markdown; it never loads remote adapters. There is no built-in remote synchronization, access control, or audit logging.

Run `npm test` to check the CLI. Licensed under [Apache-2.0](LICENSE); contributions and adapter packages are welcome.
