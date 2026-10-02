# spectacles

Publish tasks from an [OpenSpec](https://openspec.dev/) change to Markdown, Linear, or Jira, and check progress in each destination.

Requires Node.js 20 or newer. Use `node bin/spectacles.js` directly, or run `npm link` to install the `spectacles` command locally. Create a change with OpenSpec first; Spectacles reads checkbox items in `openspec/changes/<change>/tasks.md` (for example, `- [ ] 1.1 Implement search`).

```sh
node bin/spectacles.js sync add-search --target markdown
node bin/spectacles.js status add-search
node bin/spectacles.js status add-search --target markdown

export LINEAR_API_KEY=... LINEAR_TEAM_ID=...
node bin/spectacles.js sync add-search --target linear
node bin/spectacles.js status add-search --target linear

export JIRA_BASE_URL=https://example.atlassian.net
export JIRA_EMAIL=... JIRA_API_TOKEN=... JIRA_PROJECT_KEY=DEMO
node bin/spectacles.js sync add-search --target jira
node bin/spectacles.js status add-search --target jira
```

`--root <directory>` selects another OpenSpec project (default: current directory). Markdown is written to `.spectacles/<change>.md` by default; use `--output <file>` with the Markdown target to choose another path. The `status` command without a target counts OpenSpec checkboxes; with a target it reads the exported Markdown checkboxes or fetches current Linear/Jira issue statuses.

Remote issue IDs are saved in `.spectacles/state.json` so repeat syncs do not create duplicates. Keep this file with the project if teammates will sync the same changes; it contains issue IDs, **not** API credentials. OpenSpec tasks are the source for publishing: syncing creates missing issues but does not overwrite existing issues, update remote workflow states, or change the OpenSpec checklist. Numbered task prefixes (`1.1`, `1.2`, etc.) are used as stable identities; for unnumbered tasks, the task text is used. Renaming or renumbering a task can create a new issue on the next sync. Markdown export overwrites its destination, so edit `tasks.md` to make lasting changes.

Run tests with `npm test`.
