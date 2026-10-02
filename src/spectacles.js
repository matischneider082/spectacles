import { readFile, mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const taskPattern = /^\s*[-*]\s+\[([ xX])\]\s+(\S.*)$/;

export function parseTasks(markdown) {
  const seen = new Map();
  return markdown.split(/\r?\n/).flatMap(line => {
    const match = line.match(taskPattern);
    if (!match) return [];
    const title = match[2].trimEnd();
    const key = title.match(/^\d+(?:\.\d+)*/)?.[0] ?? title;
    const occurrence = (seen.get(key) ?? 0) + 1;
    seen.set(key, occurrence);
    return [{ id: `${key}#${occurrence}`, title, done: match[1].toLowerCase() === 'x' }];
  });
}

function changeName(name) {
  if (!name || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name) || name === '.' || name === '..') {
    throw new Error('Change must be a directory name under openspec/changes');
  }
  return name;
}

function option(args, flag) {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`${flag} requires a value`);
  return args[index + 1];
}

function settings(args) {
  const [command, name, ...rest] = args;
  if (!['sync', 'status'].includes(command) || !name) {
    throw new Error('Usage: spectacles <sync|status> <change> [--target markdown|linear|jira] [--root directory] [--output file]');
  }
  const flags = new Set(['--target', '--root', '--output']);
  for (let i = 0; i < rest.length; i += 2) {
    if (!flags.has(rest[i]) || !rest[i + 1] || rest[i + 1].startsWith('--')) {
      throw new Error(`Invalid option: ${rest[i] ?? ''}`);
    }
  }
  const target = option(rest, '--target');
  if (target && !['markdown', 'linear', 'jira'].includes(target)) throw new Error(`Unknown target: ${target}`);
  if (command === 'sync' && !target) throw new Error('sync requires --target');
  if (option(rest, '--output') && target !== 'markdown') throw new Error('--output requires --target markdown');
  return { command, name: changeName(name), root: resolve(option(rest, '--root') ?? '.'), target, output: option(rest, '--output') };
}

async function loadTasks(root, name) {
  const path = join(root, 'openspec', 'changes', name, 'tasks.md');
  const markdown = await readFile(path, 'utf8');
  const tasks = parseTasks(markdown);
  if (!tasks.length) throw new Error(`No checklist tasks found in ${path}`);
  return { path, markdown, tasks };
}

async function loadState(root) {
  try {
    return JSON.parse(await readFile(join(root, '.spectacles', 'state.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

async function saveState(root, state) {
  const dir = join(root, '.spectacles');
  await mkdir(dir, { recursive: true });
  const path = join(dir, 'state.json');
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await rename(temp, path);
}

async function request(url, options) {
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok || body.errors) {
    throw new Error(`${response.status} ${JSON.stringify(body.errors ?? body.errorMessages ?? body)}`);
  }
  return body;
}

function linear() {
  const token = process.env.LINEAR_API_KEY;
  if (!token) throw new Error('LINEAR_API_KEY is required');
  const call = async (query, variables) => {
    const body = await request('https://api.linear.app/graphql', {
      method: 'POST',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables })
    });
    return body.data;
  };
  return {
    async create(name, task) {
      const teamId = process.env.LINEAR_TEAM_ID;
      if (!teamId) throw new Error('LINEAR_TEAM_ID is required');
      const data = await call(
        'mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id identifier } } }',
        { input: { teamId, title: task.title, description: `OpenSpec: ${name} (task line ${task.id})` } }
      );
      if (!data?.issueCreate?.success || !data.issueCreate.issue) throw new Error('Linear issue creation failed');
      return data.issueCreate.issue;
    },
    async status(issue) {
      const data = await call('query($id: String!) { issue(id: $id) { identifier state { name type } } }', { id: issue.id });
      if (!data?.issue) throw new Error(`Linear issue ${issue.identifier} not found`);
      return { label: data.issue.identifier, status: data.issue.state.name };
    }
  };
}

function jira() {
  const base = process.env.JIRA_BASE_URL;
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  if (!base || !email || !token) throw new Error('JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN are required');
  const url = new URL(base);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('JIRA_BASE_URL must be an HTTPS URL without credentials or query parameters');
  }
  const endpoint = `${url.toString().replace(/\/$/, '')}/rest/api/3/issue`;
  const headers = {
    Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`,
    'Content-Type': 'application/json',
    Accept: 'application/json'
  };
  return {
    async create(name, task) {
      const key = process.env.JIRA_PROJECT_KEY;
      if (!key) throw new Error('JIRA_PROJECT_KEY is required');
      const body = await request(endpoint, {
        method: 'POST', headers,
        body: JSON.stringify({ fields: {
          project: { key }, issuetype: { name: 'Task' }, summary: task.title,
          description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [
            { type: 'text', text: `OpenSpec: ${name} (task line ${task.id})` }
          ] }] }
        } })
      });
      if (!body.id || !body.key) throw new Error('Jira issue creation failed');
      return { id: body.id, key: body.key };
    },
    async status(issue) {
      const body = await request(`${endpoint}/${encodeURIComponent(issue.id)}?fields=status`, { headers });
      return { label: body.key, status: body.fields.status.name };
    }
  };
}

function provider(target) {
  return target === 'linear' ? linear() : jira();
}

function markdownPath(root, name, output) {
  return resolve(root, output ?? join('.spectacles', `${name}.md`));
}

export async function run(args, log = console.log) {
  const { command, name, root, target, output } = settings(args);
  const { markdown, tasks } = await loadTasks(root, name);
  if (command === 'sync' && target === 'markdown') {
    const path = markdownPath(root, name, output);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `# ${name}\n\nSource: openspec/changes/${name}/tasks.md\n\n${markdown.trimEnd()}\n`);
    log(`Wrote ${path} (${tasks.length} tasks)`);
    return;
  }
  if (command === 'status' && !target) {
    log(`${name}: ${tasks.filter(task => task.done).length}/${tasks.length} done (OpenSpec)`);
    return;
  }
  if (command === 'status' && target === 'markdown') {
    const path = markdownPath(root, name, output);
    const published = parseTasks(await readFile(path, 'utf8'));
    log(`${name}: ${published.filter(task => task.done).length}/${published.length} done (Markdown: ${path})`);
    return;
  }
  const state = await loadState(root);
  const changeState = Object.hasOwn(state, name) ? state[name] : {};
  const entries = Object.hasOwn(changeState, target) ? changeState[target] : {};
  if (command === 'status' && !Object.keys(entries).length) {
    log(`${name}: no ${target} issues published`);
    return;
  }
  const client = provider(target);
  if (command === 'sync') {
    Object.defineProperty(state, name, { value: changeState, enumerable: true, configurable: true, writable: true });
    Object.defineProperty(changeState, target, { value: entries, enumerable: true, configurable: true, writable: true });
    for (const task of tasks) {
      if (entries[task.id]) continue;
      const issue = await client.create(name, task);
      entries[task.id] = issue;
      await saveState(root, state);
      log(`Created ${target} ${issue.identifier ?? issue.key}: ${task.title}`);
    }
    log(`${name}: ${tasks.length} tasks published to ${target}`);
  } else {
    for (const task of tasks) {
      const issue = entries[task.id];
      if (!issue) {
        log(`${task.done ? '[x]' : '[ ]'} ${task.title} — not published`);
        continue;
      }
      const remote = await client.status(issue);
      log(`${task.done ? '[x]' : '[ ]'} ${task.title} — ${remote.label}: ${remote.status}`);
    }
  }
}
