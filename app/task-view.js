import { WorkError } from './work.js';

function visit(tasks, callback, prefix = '', depth = 0) {
  tasks.forEach((task, index) => {
    const id = task.id ?? `${prefix}${index + 1}`;
    callback(task, id, depth);
    visit(task.subtasks ?? [], callback, `${id}.`, depth + 1);
  });
}

function validTasks(tasks) {
  return Array.isArray(tasks) && tasks.every((task) => task &&
    typeof task.text === 'string' && typeof task.done === 'boolean' &&
    (task.subtasks === undefined || validTasks(task.subtasks)));
}

export function validateChange(change) {
  if (!change || typeof change.slug !== 'string' || typeof change.title !== 'string' ||
      !validTasks(change.tasks)) {
    throw new WorkError('Adapter returned an invalid change (expected slug, title, and tasks with text and done).');
  }
  return change;
}

export function progress(change) {
  let completed = 0;
  let total = 0;
  visit(change.tasks, (task) => {
    total++;
    if (task.done) completed++;
  });
  return `${completed}/${total}`;
}

export function formatChange(change) {
  const lines = [`${change.title} (${change.slug}) — ${progress(change)}`];
  visit(change.tasks, (task, id, depth) => {
    const indent = '  '.repeat(depth + 1);
    lines.push(`${indent}${id}. [${task.done ? 'x' : ' '}] ${task.text}`);
    if (task.resolution) lines.push(`${indent}  Resolution: ${task.resolution}`);
    for (const image of task.screenshots ?? []) lines.push(`${indent}  Screenshot: ${image.path}`);
  });
  return lines;
}
