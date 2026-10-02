# Adapter contract

Spectacles uses a small asynchronous interface so the same commands can target different stores. The built-in `markdown` adapter is implemented in `app/adapters/markdown.js`. Third-party adapters are installed as npm packages and activated by an explicit `.spectacles.json` entry; there is no automatic plugin discovery.

Export a named `createAdapter({ cwd, options })` function. It may return an adapter or a promise of one. Implement the five core methods; `addSubtask` and `attachScreenshot` are optional capabilities and the CLI reports when an adapter lacks them. Methods may be synchronous or asynchronous:

| Method | Input | Output |
| --- | --- | --- |
| `createChange(title)` | Nonempty one-line title | Change identifier string |
| `addTask(slug, text)` | Change identifier and one-line task | No required value |
| `completeTask(slug, id, resolution)` | Change identifier, displayed task ID, and required one-line resolution | No required value |
| `addSubtask(slug, parentId, text)` | Parent task ID and one-line text | New subtask ID string |
| `attachScreenshot(slug, id, file)` | Task ID and absolute local image file path | Stored screenshot path string |
| `getChange(slug)` | Change identifier | Change object |
| `listChanges()` | None | Array of change objects |

A change object has `{ slug: string, title: string, tasks: Array<Task> }`; each `Task` has `text: string`, `done: boolean`, and optional `id: string`, `subtasks: Task[]`, `resolution: string`, and `screenshots: Array<{ name: string, path: string }>`. Task ordering is significant; without an `id`, `show` derives IDs from array positions. Adapters must enforce a resolution on completion and ensure descendants are finished before the parent; the CLI checks input but does not control remote persistence. `attachScreenshot` receives a temporary file for screen capture, so the adapter must copy/upload it before returning. Do not return success unless a mutation is durable; throw a descriptive error on authorization, validation, transport, or persistence failure. The CLI displays these errors and exits unsuccessfully. Treat remote data and `options` as untrusted input.

Minimal package entry point (`index.js`):

```js
export function createAdapter({ cwd, options }) {
  return {
    async createChange(title) { /* create work and return its identifier */ },
    async addTask(slug, text) { /* persist the new task */ },
    async completeTask(slug, id, resolution) { /* verify children, persist completion and resolution */ },
    async addSubtask(slug, parentId, text) { /* optional: return the new ID */ },
    async attachScreenshot(slug, id, file) { /* optional: copy/upload and return its path */ },
    async getChange(slug) { /* return { slug, title, tasks } */ },
    async listChanges() { /* return an array of changes */ },
  };
}
```

Publish an ESM package with a resolvable entry point (for example `"exports": { ".": { "default": "./index.js" } }` in its `package.json`), install it as a dependency of the consuming project, then put its exact package name in `.spectacles.json`. The package is resolved relative to that project, not to Spectacles. `options` should contain nonsecret settings only; adapter code can obtain secrets from the environment or an approved credential provider. A package with import-only conditional exports may not resolve; expose a `default` condition as shown above.

An adapter owns its storage and consistency model. The CLI does not mirror its results into local Markdown or synchronize between adapters. The `github` subcommands use `gh` directly and do not use adapters or sync local work. Linear/Jira adapters, if added later, should explicitly define mapping, conflict handling, permissions, and rate-limit behavior rather than silently falling back to local files. This version extends the `completeTask` call with a required resolution; external adapters must update their method implementation.
