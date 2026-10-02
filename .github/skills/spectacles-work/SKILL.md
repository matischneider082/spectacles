---
name: spectacles-work
description: Create and track OpenSpec-style proposals, nested tasks, resolutions, screenshots, and explicit GitHub issues and Projects v2 items using the Spectacles CLI. Use when asked to plan, create, inspect, or update work in this repository.
---

# Spectacles work

Use `node app/cli.js` from the repository root. No install or external account is required.

1. Run `node app/cli.js list` to find existing changes before creating a new one.
2. For new work, run `node app/cli.js new "Short title"`; edit the generated `openspec/changes/<slug>/proposal.md` to replace its placeholders with the actual problem and solution.
3. Add actionable tasks with `node app/cli.js add <slug> "Task description"` and subtasks with `node app/cli.js subtask <slug> <parent-id> "Subtask"`. Use `show` for IDs such as `1.1`. Add screenshot evidence with `screenshot <slug> <id> <image-file>` (or omit the image file to capture the screen, only with the user's permission).
4. After verifying work, run `node app/cli.js done <slug> <id> "Resolution describing what was done"`. Complete every child first. Keep `tasks.md` as Markdown checkboxes with resolution and screenshot evidence; do not mark unverified work done.
5. Use explicit `node app/cli.js github ...` commands for GitHub issues and Projects v2. Follow `AGENTS.md` and `node app/cli.js help`; do not infer that local work is synced.

Local work stays in Markdown. GitHub operations use `gh` login and do not sync local work. Do not claim a Linear or Jira issue was created or synced; those integrations are not implemented.
