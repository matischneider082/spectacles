# Working with Spectacles

These instructions apply to any coding agent working in this repository. The CLI and Markdown files are the source of truth; no vendor-specific agent feature is required.

- Run `node app/cli.js list` and `node app/cli.js show <change>` before changing work. Changes live in `openspec/changes/<slug>/`.
- Create a change with `node app/cli.js new "Title"`, then replace the placeholders in its `proposal.md`.
- Add tasks with `node app/cli.js add <change> "Task"` and nested work with `node app/cli.js subtask <change> <parent-id> "Subtask"`. `show` displays IDs like `1`, `1.1`, and `1.1.1`.
- Only after implementation and verification, run `node app/cli.js done <change> <id> "Resolution describing the result"`. Finish all descendants before the parent. Evidence can be attached with `node app/cli.js screenshot <change> <id> <image-file>` or captured with the same command without a file (with the user's permission to record their screen).
- GitHub issue and Projects v2 commands are explicit and separate from local changes; run `node app/cli.js help` for syntax. Do not claim a GitHub item was created or changed unless the command succeeds. Never copy a screenshot or secret to GitHub without the user's direction.
- Run `npm test` after changes to the CLI or adapters. Keep `.github/skills/spectacles-work/SKILL.md` and `docs/adapters.md` aligned when changing commands or the adapter contract.
