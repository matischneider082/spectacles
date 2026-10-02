import { constants, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { imageTypes, isImage } from './integrations/images.js';

export class WorkError extends Error {}

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const taskPattern = /^(\s*)-\s+\[([ xX])\](\s+)(.+)$/;
const resolutionPattern = /^\s+\*\*Resolution:\*\* (.+)$/;
const screenshotPattern = /^\s+\*\*Screenshot:\*\* !\[([^\]]+)\]\((screenshots\/[^)]+)\)$/;
const taskIdPattern = /^[1-9]\d*(?:\.[1-9]\d*)*$/;

function changesPath(cwd) {
  return join(cwd, 'openspec', 'changes');
}

function changePath(cwd, slug) {
  if (!slugPattern.test(slug)) {
    throw new WorkError(`Invalid change name "${slug}". Use lowercase letters, numbers and hyphens.`);
  }
  return join(changesPath(cwd), slug);
}

function parseTasks(contents) {
  const lines = contents.split('\n');
  const roots = [];
  const all = [];
  const stack = [];
  for (const [lineIndex, line] of lines.entries()) {
    const match = line.match(taskPattern);
    if (match) {
      const indent = match[1].length;
      while (stack.length && stack.at(-1).indent >= indent) stack.pop();
      const parent = stack.at(-1);
      const siblings = parent?.task.subtasks ?? roots;
      const id = parent ? `${parent.task.id}.${siblings.length + 1}` : `${roots.length + 1}`;
      const task = { id, text: match[4], done: match[2].toLowerCase() === 'x', subtasks: [], screenshots: [] };
      siblings.push(task);
      const record = { task, lineIndex, indent };
      all.push(record);
      stack.push(record);
    } else if (stack.length) {
      const current = stack.at(-1).task;
      const resolution = line.match(resolutionPattern);
      const screenshot = line.match(screenshotPattern);
      if (resolution) current.resolution = resolution[1];
      if (screenshot) current.screenshots.push({ name: screenshot[1], path: screenshot[2] });
    }
  }
  return { lines, roots, all };
}

function readTasks(cwd, slug) {
  const path = join(changePath(cwd, slug), 'tasks.md');
  if (!existsSync(join(changePath(cwd, slug), 'proposal.md')) || !existsSync(path)) {
    throw new WorkError(`Change "${slug}" not found.`);
  }
  return { path, ...parseTasks(readFileSync(path, 'utf8')) };
}

function findTask(parsed, id) {
  if (!taskIdPattern.test(id)) throw new WorkError(`Invalid task number "${id}". Use a number from show, such as 1 or 1.1.`);
  const record = parsed.all.find(({ task }) => task.id === id);
  if (!record) throw new WorkError(`Task ${id} not found.`);
  return record;
}

function requireLine(text, label) {
  if (typeof text !== 'string' || !text.trim() || /[\r\n]/.test(text)) {
    throw new WorkError(`${label} must be nonempty and fit on one line.`);
  }
  return text.trim();
}

function allChildrenDone(tasks) {
  return tasks.every((task) => task.done && allChildrenDone(task.subtasks));
}

function writeLines(path, lines) {
  writeFileSync(path, lines.join('\n'));
}

function readChange(cwd, slug) {
  const { roots } = readTasks(cwd, slug);
  const proposal = readFileSync(join(changePath(cwd, slug), 'proposal.md'), 'utf8');
  const title = proposal.match(/^# (.+)$/m)?.[1] ?? slug;
  return { slug, title, tasks: roots };
}

export function listChanges(cwd) {
  const root = changesPath(cwd);
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'archive' && slugPattern.test(entry.name))
    .map((entry) => readChange(cwd, entry.name));
}

export function getChange(cwd, slug) {
  return readChange(cwd, slug);
}

export function createChange(cwd, title) {
  const cleanTitle = requireLine(title, 'Title');
  const slug = cleanTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!slug) throw new WorkError('Title must contain at least one ASCII letter or number.');
  const dir = changePath(cwd, slug);
  mkdirSync(changesPath(cwd), { recursive: true });
  if (existsSync(dir)) throw new WorkError(`Change "${slug}" already exists.`);
  mkdirSync(dir);
  writeFileSync(join(dir, 'proposal.md'), `# ${cleanTitle}\n\n## Why\n\nDescribe the problem.\n\n## What changes\n\nDescribe the proposed solution.\n`, { flag: 'wx' });
  writeFileSync(join(dir, 'tasks.md'), '# Tasks\n\n', { flag: 'wx' });
  return slug;
}

export function addTask(cwd, slug, text) {
  const cleanText = requireLine(text, 'Task');
  const { path } = readTasks(cwd, slug);
  const contents = readFileSync(path, 'utf8');
  writeFileSync(path, `${contents}${contents.endsWith('\n') ? '' : '\n'}- [ ] ${cleanText}\n`);
}

export function addSubtask(cwd, slug, parentId, text) {
  const cleanText = requireLine(text, 'Subtask');
  const parsed = readTasks(cwd, slug);
  const parent = findTask(parsed, parentId);
  if (parent.task.done) throw new WorkError(`Task ${parentId} is already done.`);
  const end = parsed.all.find((record) => record.lineIndex > parent.lineIndex && record.indent <= parent.indent)?.lineIndex ?? parsed.lines.length;
  let insertAt = end;
  while (insertAt > parent.lineIndex + 1 && !parsed.lines[insertAt - 1].trim()) insertAt--;
  parsed.lines.splice(insertAt, 0, `${' '.repeat(parent.indent + 2)}- [ ] ${cleanText}`);
  writeLines(parsed.path, parsed.lines);
  return `${parentId}.${parent.task.subtasks.length + 1}`;
}

export function completeTask(cwd, slug, id, resolution) {
  const cleanResolution = requireLine(resolution, 'Resolution');
  const parsed = readTasks(cwd, slug);
  const record = findTask(parsed, id);
  if (record.task.done) throw new WorkError(`Task ${id} is already done.`);
  if (!allChildrenDone(record.task.subtasks)) {
    throw new WorkError(`Complete all subtasks of ${id} before completing it.`);
  }
  const line = parsed.lines[record.lineIndex];
  parsed.lines[record.lineIndex] = line.replace(taskPattern, (_, indent, status, spacing, text) =>
    `${indent}- [x]${spacing}${text}`);
  parsed.lines.splice(record.lineIndex + 1, 0, `${' '.repeat(record.indent + 2)}**Resolution:** ${cleanResolution}`);
  writeLines(parsed.path, parsed.lines);
}

export function attachScreenshot(cwd, slug, id, source) {
  const parsed = readTasks(cwd, slug);
  const record = findTask(parsed, id);
  if (typeof source !== 'string' || !source) throw new WorkError('Screenshot file is required.');
  const ext = extname(source).toLowerCase();
  if (!imageTypes.has(ext)) throw new WorkError('Screenshot must be a PNG, JPEG, or WebP image.');
  let stat;
  try {
    stat = statSync(source);
  } catch (error) {
    if (error.code === 'ENOENT') throw new WorkError(`Screenshot source not found: ${source}`);
    throw error;
  }
  if (!stat.isFile()) throw new WorkError('Screenshot source must be a file.');
  if (!isImage(source, ext)) throw new WorkError('Screenshot file does not match its image format.');
  const dir = join(changePath(cwd, slug), 'screenshots');
  const name = `${randomUUID()}${ext}`;
  mkdirSync(dir, { recursive: true });
  const relative = `screenshots/${name}`;
  copyFileSync(source, join(dir, name), constants.COPYFILE_EXCL);
  const label = basename(source).replace(/[\[\]\r\n]/g, '_');
  parsed.lines.splice(record.lineIndex + 1, 0,
    `${' '.repeat(record.indent + 2)}**Screenshot:** ![${label}](${relative})`);
  try {
    writeLines(parsed.path, parsed.lines);
  } catch (error) {
    unlinkSync(join(dir, name));
    throw error;
  }
  return relative;
}
