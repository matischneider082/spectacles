import { spawnSync } from 'node:child_process';
import { WorkError } from '../work.js';

const repoPattern = /^(?:[a-z0-9.-]+\/)?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\/[a-z0-9._-]+$/i;
const ownerPattern = /^(?:@me|[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)$/i;
const numberPattern = /^[1-9]\d*$/;

function valid(value, pattern, label) {
  if (!value || !pattern.test(value)) throw new WorkError(`Invalid ${label}: ${value ?? '(missing)'}.`);
  return value;
}

function required(value, label) {
  if (!value?.trim()) throw new WorkError(`${label} is required.`);
  return value;
}

function issueUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new WorkError('A full HTTPS GitHub issue URL is required.');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      !/^\/[^/]+\/[^/]+\/issues\/[1-9]\d*\/?$/.test(url.pathname)) {
    throw new WorkError('A full HTTPS GitHub issue URL is required.');
  }
  return value;
}

function gh(args, cwd, spawn) {
  const result = spawn('gh', args, {
    cwd, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, GH_PROMPT_DISABLED: '1', GIT_TERMINAL_PROMPT: '0' },
  });
  if (result.error) throw new WorkError(`GitHub CLI failed: ${result.error.message}`);
  if (result.status !== 0) throw new WorkError(`GitHub CLI failed: ${(result.stderr || result.stdout || `exit ${result.status}`).trim()}`);
  return result.stdout.trim();
}

export function runGithub(args, cwd, spawn = spawnSync) {
  const [area, action, ...rest] = args;
  if (area === 'issue' && action === 'new' && rest.length >= 3) {
    const [repo, title, ...body] = rest;
    return gh(['issue', 'create', '--repo', valid(repo, repoPattern, 'repository'),
      '--title', required(title, 'Title'), '--body', required(body.join(' '), 'Body')], cwd, spawn);
  }
  if (area === 'issue' && action === 'edit' && rest.length >= 3) {
    const [repo, number, flag, ...value] = rest;
    if (!['--title', '--body'].includes(flag)) throw new WorkError('Use --title or --body to edit an issue.');
    return gh(['issue', 'edit', valid(number, numberPattern, 'issue number'),
      '--repo', valid(repo, repoPattern, 'repository'), flag, required(value.join(' '), flag)], cwd, spawn);
  }
  if (area === 'project' && action === 'new' && rest.length >= 2) {
    const [owner, ...title] = rest;
    return gh(['project', 'create', '--owner', valid(owner, ownerPattern, 'owner'),
      '--title', required(title.join(' '), 'Title'), '--format', 'json'], cwd, spawn);
  }
  if (area === 'project' && action === 'edit' && rest.length >= 4) {
    const [owner, number, flag, ...value] = rest;
    if (!['--title', '--description'].includes(flag)) throw new WorkError('Use --title or --description to edit a project.');
    return gh(['project', 'edit', valid(number, numberPattern, 'project number'),
      '--owner', valid(owner, ownerPattern, 'owner'), flag, required(value.join(' '), flag), '--format', 'json'], cwd, spawn);
  }
  if (area === 'project' && action === 'add' && rest.length === 3) {
    const [owner, number, url] = rest;
    return gh(['project', 'item-add', valid(number, numberPattern, 'project number'),
      '--owner', valid(owner, ownerPattern, 'owner'), '--url', issueUrl(url), '--format', 'json'], cwd, spawn);
  }
  if (area === 'project' && action === 'status' && rest.length >= 4) {
    const [owner, number, url, ...status] = rest;
    return gh(['project', 'item-edit', valid(number, numberPattern, 'project number'),
      '--owner', valid(owner, ownerPattern, 'owner'), '--url', issueUrl(url),
      '--field', 'Status', '--value', required(status.join(' '), 'Status'), '--format', 'json'], cwd, spawn);
  }
  throw new WorkError(`Unknown GitHub command. Run "spectacles help" for usage.`);
}
