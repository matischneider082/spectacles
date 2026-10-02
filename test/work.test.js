import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, test } from 'node:test';
import { withCapturedScreenshot } from '../app/integrations/capture.js';
import { runGithub } from '../app/integrations/github.js';
import { WorkError } from '../app/work.js';

const cli = resolve('app/cli.js');
const hook = resolve('.github/hooks/session-start.mjs');
const dirs = [];

function workspace() {
  const dir = mkdtempSync(join(tmpdir(), 'spectacles-test-'));
  dirs.push(dir);
  return dir;
}

function run(dir, ...args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8' });
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true });
});

test('creates, tracks and completes Markdown work', () => {
  const dir = workspace();
  assert.match(run(dir, 'list').stdout, /No changes yet/);
  assert.equal(run(dir, 'new', 'Improve onboarding').status, 0);
  assert.match(readFileSync(join(dir, 'openspec/changes/improve-onboarding/proposal.md'), 'utf8'), /# Improve onboarding/);
  assert.equal(run(dir, 'add', 'improve-onboarding', 'Write proposal').status, 0);
  assert.equal(run(dir, 'add', 'improve-onboarding', 'Build screen').status, 0);
  assert.match(run(dir, 'show', 'improve-onboarding').stdout, /1\. \[ \] Write proposal/);
  assert.equal(run(dir, 'done', 'improve-onboarding', '1', 'Proposal approved').status, 0);
  assert.match(run(dir, 'list').stdout, /improve-onboarding  1\/2  Improve onboarding/);
  assert.match(run(dir, 'show', 'improve-onboarding').stdout, /1\. \[x\] Write proposal/);
  assert.match(readFileSync(join(dir, 'openspec/changes/improve-onboarding/tasks.md'), 'utf8'), /- \[x\] Write proposal\n  \*\*Resolution:\*\* Proposal approved/);
});

test('preserves hand-edited Markdown and counts existing checkboxes', () => {
  const dir = workspace();
  run(dir, 'new', 'Track work');
  mkdirSync(join(dir, 'openspec/changes/archive'));
  assert.match(run(dir, 'list').stdout, /track-work  0\/0/);
  const tasks = join(dir, 'openspec/changes/track-work/tasks.md');
  writeFileSync(tasks, '# Tasks\n\n## Phase 1\n  - [X] Done already\n  - [ ]   Keep spacing\n');
  assert.match(run(dir, 'show', 'track-work').stdout, /2\. \[ \] Keep spacing/);
  assert.equal(run(dir, 'done', 'track-work', '2', 'Reviewed').status, 0);
  assert.match(readFileSync(tasks, 'utf8'), /## Phase 1\n  - \[X\] Done already\n  - \[x\]   Keep spacing\n    \*\*Resolution:\*\* Reviewed/);
});

test('reports invalid input without overwriting changes', () => {
  const dir = workspace();
  assert.equal(run(dir, 'new', 'Repeat').status, 0);
  const proposal = join(dir, 'openspec/changes/repeat/proposal.md');
  writeFileSync(proposal, '# My edited proposal\n');
  const duplicate = run(dir, 'new', 'Repeat');
  assert.equal(duplicate.status, 1);
  assert.match(duplicate.stderr, /already exists/);
  assert.equal(readFileSync(proposal, 'utf8'), '# My edited proposal\n');
  for (const args of [
    ['done', 'repeat', '0'],
    ['done', 'repeat', '1'],
    ['add', '../outside', 'no'],
    ['show', 'missing'],
    ['new', '!!!'],
    ['unknown'],
  ]) {
    const result = run(dir, ...args);
    assert.equal(result.status, 1, args.join(' '));
    assert.ok(result.stderr, args.join(' '));
  }
});

test('nested subtasks require resolution and block parent completion', () => {
  const dir = workspace();
  run(dir, 'new', 'Nested work');
  run(dir, 'add', 'nested-work', 'Parent');
  run(dir, 'add', 'nested-work', 'Sibling');
  assert.equal(run(dir, 'subtask', 'nested-work', '1', 'Child A').status, 0);
  assert.equal(run(dir, 'subtask', 'nested-work', '1', 'Child B').status, 0);
  assert.equal(run(dir, 'subtask', 'nested-work', '1.1', 'Grandchild').status, 0);
  assert.match(run(dir, 'show', 'nested-work').stdout, /1\.1\.1\. \[ \] Grandchild/);
  assert.match(run(dir, 'list').stdout, /0\/5/);
  assert.match(run(dir, 'done', 'nested-work', '1', 'Finished').stderr, /Complete all subtasks/);
  assert.match(run(dir, 'done', 'nested-work', '1.1', 'Finished').stderr, /Complete all subtasks/);
  assert.equal(run(dir, 'done', 'nested-work', '1.1.1').status, 1);
  assert.equal(run(dir, 'done', 'nested-work', '1.1.1', 'Verified').status, 0);
  assert.equal(run(dir, 'done', 'nested-work', '1.1', 'Implemented').status, 0);
  assert.equal(run(dir, 'done', 'nested-work', '1.2', 'Tested').status, 0);
  assert.equal(run(dir, 'done', 'nested-work', '1', 'Released').status, 0);
  assert.match(run(dir, 'show', 'nested-work').stdout, /4\/5[\s\S]*1\. \[x\] Parent/);
  assert.match(run(dir, 'subtask', 'nested-work', '1', 'Too late').stderr, /already done/);
  const tasks = readFileSync(join(dir, 'openspec/changes/nested-work/tasks.md'), 'utf8');
  assert.match(tasks, /- \[x\] Parent\n  \*\*Resolution:\*\* Released\n  - \[x\] Child A\n    \*\*Resolution:\*\* Implemented/);
  assert.match(tasks, /- \[ \] Sibling/);
});

test('attach existing screenshots to a task without changing its status', () => {
  const dir = workspace();
  run(dir, 'new', 'Visual work');
  run(dir, 'add', 'visual-work', 'Capture state');
  run(dir, 'subtask', 'visual-work', '1', 'Inspect modal');
  const source = join(dir, 'example.png');
  writeFileSync(source, Buffer.from('89504e470d0a1a0a', 'hex'));
  assert.equal(run(dir, 'screenshot', 'visual-work', '1.1', 'example.png').status, 0);
  const evidence = join(dir, 'openspec/changes/visual-work/screenshots');
  const [filename] = readdirSync(evidence);
  assert.deepEqual(readFileSync(join(evidence, filename)), readFileSync(source));
  assert.match(run(dir, 'show', 'visual-work').stdout, new RegExp(`Screenshot: screenshots/${filename.replace('.', '\\.')}`));
  assert.match(readFileSync(join(dir, 'openspec/changes/visual-work/tasks.md'), 'utf8'), /\*\*Screenshot:\*\* !\[example.png\]\(screenshots\/.*\.png\)/);
  assert.equal(run(dir, 'screenshot', 'visual-work', '1', 'missing.png').status, 1);
  writeFileSync(join(dir, 'fake.png'), 'not an image');
  assert.match(run(dir, 'screenshot', 'visual-work', '1', 'fake.png').stderr, /does not match/);
  assert.equal(readdirSync(evidence).length, 1);
  assert.equal(run(dir, 'done', 'visual-work', '1.1', 'Screenshot reviewed').status, 0);
  assert.match(run(dir, 'show', 'visual-work').stdout, /Resolution: Screenshot reviewed/);
});

test('capture invokes native tools and cleans up even on failure', async () => {
  const signature = Buffer.from('89504e470d0a1a0a', 'hex');
  for (const platform of ['darwin', 'win32', 'linux']) {
    let command;
    let temporary;
    const attached = await withCapturedScreenshot(async (path) => {
      assert.deepEqual(readFileSync(path), signature);
      temporary = path;
      return 'stored.png';
    }, {
      platform,
      capture: (name, args, env) => {
        command = name;
        const path = platform === 'win32' ? env.SPECTACLES_SCREENSHOT_PATH : args.at(-1);
        writeFileSync(path, signature);
        return { status: 0, stdout: '', stderr: '' };
      },
    });
    assert.equal(attached, 'stored.png');
    assert.equal(existsSync(temporary), false);
    assert.equal(command, { darwin: 'screencapture', win32: 'powershell.exe', linux: 'grim' }[platform]);
  }
  await assert.rejects(withCapturedScreenshot(() => {}, {
    platform: 'linux',
    capture: () => ({ error: { code: 'ENOENT' } }),
  }), WorkError);
});

test('GitHub commands use explicit IDs and safe gh arguments', () => {
  const calls = [];
  const spawn = (cmd, args, options) => {
    calls.push({ cmd, args, options });
    return { status: 0, stdout: 'https://github.com/example/repo/issues/42\n', stderr: '' };
  };
  const cwd = workspace();
  const url = 'https://github.com/example/repo/issues/42';
  assert.equal(runGithub(['issue', 'new', 'example/repo', 'Title', 'Issue body'], cwd, spawn), url);
  runGithub(['issue', 'edit', 'example/repo', '42', '--body', 'Fixed body'], cwd, spawn);
  runGithub(['project', 'new', 'example', 'Roadmap'], cwd, spawn);
  runGithub(['project', 'edit', 'example', '3', '--description', 'Release work'], cwd, spawn);
  runGithub(['project', 'add', 'example', '3', url], cwd, spawn);
  runGithub(['project', 'status', 'example', '3', url, 'In Progress'], cwd, spawn);
  assert.equal(calls.length, 6);
  assert.deepEqual(calls[0].args, ['issue', 'create', '--repo', 'example/repo', '--title', 'Title', '--body', 'Issue body']);
  assert.deepEqual(calls[5].args, ['project', 'item-edit', '3', '--owner', 'example', '--url', url,
    '--field', 'Status', '--value', 'In Progress', '--format', 'json']);
  assert.ok(calls.every(({ cmd, options }) => cmd === 'gh' && options.env.GH_PROMPT_DISABLED === '1'));
  assert.throws(() => runGithub(['project', 'add', 'example', '3', 'http://bad.test/x'], cwd, spawn), WorkError);
  assert.throws(() => runGithub(['issue', 'new', '../repo', 'Title', 'Body'], cwd, spawn), WorkError);
  assert.equal(calls.length, 6);
  assert.throws(() => runGithub(['issue', 'new', 'example/repo', 'Title', 'Body'], cwd,
    () => ({ status: 1, stderr: 'permission denied' })), /permission denied/);
});

test('GitHub CLI route does not load adapters or silently modify local files', { skip: process.platform === 'win32' }, () => {
  const dir = workspace();
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  const gh = join(bin, 'gh');
  writeFileSync(gh, '#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify(process.argv.slice(2)));\n');
  chmodSync(gh, 0o755);
  writeFileSync(join(dir, '.spectacles.json'), '{ invalid config');
  const result = spawnSync(process.execPath, [cli, 'github', 'issue', 'new', 'owner/repo', 'Title', 'Body'], {
    cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });
  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout), ['issue', 'create', '--repo', 'owner/repo', '--title', 'Title', '--body', 'Body']);
  assert.equal(existsSync(join(dir, 'openspec')), false);
});

test('hook supplies local progress as JSON context', () => {
  const dir = workspace();
  run(dir, 'new', 'Track work');
  run(dir, 'add', 'track-work', 'First task');
  run(dir, 'subtask', 'track-work', '1', 'Nested task');
  run(dir, 'done', 'track-work', '1.1', 'Verified');
  const result = spawnSync(process.execPath, [hook], { cwd: dir, encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(JSON.parse(result.stdout).additionalContext, /track-work: 1\/2 tasks/);
  assert.match(run(dir, 'list').stdout, /track-work  1\/2/);
});

test('loads an explicitly configured package adapter from the project', () => {
  const dir = workspace();
  const adapterDir = join(dir, 'node_modules/@example/spectacles-adapter');
  mkdirSync(adapterDir, { recursive: true });
  writeFileSync(join(adapterDir, 'package.json'), JSON.stringify({
    name: '@example/spectacles-adapter', type: 'module', exports: { '.': { default: './index.js' } },
  }));
  writeFileSync(join(adapterDir, 'index.js'), `
    export function createAdapter({ options }) {
      return {
        createChange: async (title) => options.prefix + title,
        addTask: async () => {},
        completeTask: async () => {},
        getChange: async (slug) => ({ slug, title: 'Remote', tasks: [{ text: 'Sync', done: false }] }),
        listChanges: async () => [{ slug: 'remote', title: 'Remote', tasks: [] }],
      };
    }
  `);
  writeFileSync(join(dir, '.spectacles.json'), JSON.stringify({
    adapters: { team: { package: '@example/spectacles-adapter', options: { prefix: 'remote-' } } },
  }));
  assert.match(run(dir, '--adapter', 'team', 'new', 'work').stdout, /Created remote-work with team/);
  assert.match(run(dir, '--adapter', 'team', 'list').stdout, /remote  0\/0  Remote/);
  assert.match(run(dir, '--adapter', 'team', 'show', 'remote').stdout, /1\. \[ \] Sync/);
  assert.match(run(dir, 'list').stdout, /No changes yet/);

  writeFileSync(join(dir, '.spectacles.json'), JSON.stringify({
    defaultAdapter: 'team', adapters: { team: { package: '@example/spectacles-adapter' } },
  }));
  assert.match(run(dir, 'list').stdout, /remote  0\/0  Remote/);
});

test('rejects malformed or unapproved adapter configuration', () => {
  const dir = workspace();
  const config = join(dir, '.spectacles.json');
  for (const value of [
    '{',
    JSON.stringify({ adapters: { team: { package: '../untrusted.js' } } }),
    JSON.stringify({ adapters: { team: { package: 42 } } }),
    JSON.stringify({ adapters: { team: { package: 'missing-adapter' } } }),
    JSON.stringify({ adapters: { team: { package: 'safe-package', optoins: {} } } }),
  ]) {
    writeFileSync(config, value);
    const result = run(dir, '--adapter', 'team', 'list');
    assert.equal(result.status, 1);
    assert.ok(result.stderr);
  }
});
