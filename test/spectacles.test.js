import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseTasks, run } from '../src/spectacles.js';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'spectacles-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dir = join(root, 'openspec', 'changes', 'add-search');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'tasks.md'), '## Implementation\n- [ ] 1.1 Build API\n- [x] 1.2 Add tests\n');
  return root;
}

test('parse OpenSpec checklists with stable task identifiers', () => {
  const before = parseTasks('## Tasks\n- [ ] 1.1 Build API\n  * [X] 1.2 Add tests\n- [ ] Repeat\n- [x] Repeat');
  const after = parseTasks('\n# New heading\n- [x] 1.1 Build API\n  * [X] 1.2 Add tests\n- [ ] Repeat\n- [x] Repeat');
  assert.deepEqual(before.map(task => task.id), after.map(task => task.id));
  assert.deepEqual(before.map(task => task.done), [false, true, false, true]);
  assert.notEqual(before[2].id, before[3].id);
});

test('exports Markdown and reports local and published progress', async t => {
  const root = await fixture(t);
  const lines = [];
  await run(['sync', 'add-search', '--root', root, '--target', 'markdown'], line => lines.push(line));
  const output = await readFile(join(root, '.spectacles', 'add-search.md'), 'utf8');
  assert.match(output, /- \[ \] 1\.1 Build API/);
  await run(['status', 'add-search', '--root', root], line => lines.push(line));
  await run(['status', 'add-search', '--root', root, '--target', 'markdown'], line => lines.push(line));
  assert.match(lines.at(-2), /1\/2 done \(OpenSpec\)/);
  assert.match(lines.at(-1), /1\/2 done \(Markdown/);
});

test('Linear sync creates once and status retrieves remote state', async t => {
  const root = await fixture(t);
  const previous = globalThis.fetch;
  const requests = [];
  process.env.LINEAR_API_KEY = 'test-key';
  process.env.LINEAR_TEAM_ID = 'team-id';
  globalThis.fetch = async (url, options) => {
    requests.push({ url, ...options });
    const { query } = JSON.parse(options.body);
    const data = query.startsWith('mutation')
      ? { issueCreate: { success: true, issue: { id: `id-${requests.length}`, identifier: `TEAM-${requests.length}` } } }
      : { issue: { identifier: 'TEAM-1', state: { name: 'In Progress', type: 'started' } } };
    return { ok: true, json: async () => ({ data }) };
  };
  t.after(() => {
    globalThis.fetch = previous;
    delete process.env.LINEAR_API_KEY;
    delete process.env.LINEAR_TEAM_ID;
  });
  const lines = [];
  const args = ['sync', 'add-search', '--root', root, '--target', 'linear'];
  await run(args, line => lines.push(line));
  await run(args, line => lines.push(line));
  assert.equal(requests.length, 2);
  const state = JSON.parse(await readFile(join(root, '.spectacles', 'state.json'), 'utf8'));
  assert.equal(Object.keys(state['add-search'].linear).length, 2);
  await run(['status', 'add-search', '--root', root, '--target', 'linear'], line => lines.push(line));
  assert.equal(requests.length, 4);
  assert.match(lines.at(-1), /TEAM-1: In Progress/);
});

test('Jira creates tasks using ADF and tracks status', async t => {
  const root = await fixture(t);
  const previous = globalThis.fetch;
  const requests = [];
  Object.assign(process.env, {
    JIRA_BASE_URL: 'https://example.atlassian.net',
    JIRA_EMAIL: 'test@example.com',
    JIRA_API_TOKEN: 'test-token',
    JIRA_PROJECT_KEY: 'DEMO'
  });
  globalThis.fetch = async (url, options) => {
    requests.push({ url, ...options });
    return { ok: true, json: async () => options.method === 'POST'
      ? { id: String(requests.length), key: `DEMO-${requests.length}` }
      : { key: 'DEMO-1', fields: { status: { name: 'Done' } } } };
  };
  t.after(() => {
    globalThis.fetch = previous;
    for (const key of ['JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN', 'JIRA_PROJECT_KEY']) delete process.env[key];
  });
  await run(['sync', 'add-search', '--root', root, '--target', 'jira'], () => {});
  const fields = JSON.parse(requests[0].body).fields;
  assert.equal(fields.description.type, 'doc');
  assert.equal(fields.project.key, 'DEMO');
  const lines = [];
  await run(['status', 'add-search', '--root', root, '--target', 'jira'], line => lines.push(line));
  assert.match(lines[0], /DEMO-1: Done/);
  assert.match(requests[2].url, /\/rest\/api\/3\/issue\/1\?fields=status$/);
});

test('rejects invalid change paths and insecure Jira URLs', async t => {
  const root = await fixture(t);
  await assert.rejects(run(['sync', '../other', '--root', root, '--target', 'markdown']), /Change must/);
  process.env.JIRA_BASE_URL = 'http://example.org';
  process.env.JIRA_EMAIL = 'test@example.com';
  process.env.JIRA_API_TOKEN = 'test-token';
  t.after(() => {
    delete process.env.JIRA_BASE_URL;
    delete process.env.JIRA_EMAIL;
    delete process.env.JIRA_API_TOKEN;
  });
  await assert.rejects(run(['sync', 'add-search', '--root', root, '--target', 'jira']), /HTTPS URL/);
});
