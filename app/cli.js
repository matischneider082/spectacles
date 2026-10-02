#!/usr/bin/env node
import { WorkError } from './work.js';
import { formatChange, progress, validateChange } from './task-view.js';
import { loadAdapter } from './adapters/load.js';
import { withCapturedScreenshot } from './integrations/capture.js';
import { runGithub } from './integrations/github.js';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const usage = `Usage: spectacles [--adapter <name>] <command>
  spectacles new <title>          Create an OpenSpec-style change
  spectacles add <change> <task>   Add a task
  spectacles subtask <change> <parent> <text>   Add a nested task (e.g. parent 1)
  spectacles done <change> <id> <resolution>   Complete a task (e.g. id 1.1)
  spectacles screenshot <change> <id> [image]  Capture screen or attach an image
  spectacles show <change>         Show a change and its tasks
  spectacles list                  List changes and progress
  spectacles github issue new <repo> <title> <body>
  spectacles github issue edit <repo> <number> --title|--body <value>
  spectacles github project new <owner> <title>
  spectacles github project edit <owner> <number> --title|--description <value>
  spectacles github project add <owner> <number> <issue-url>
  spectacles github project status <owner> <number> <issue-url> <status>
  spectacles help                  Show this help`;

export async function run(args, cwd = process.cwd(), output = console.log, error = console.error) {
  let selected;
  if (args[0] === '--adapter') {
    if (!args[1]) {
      error('Usage: spectacles --adapter <name> <command>');
      return 1;
    }
    selected = args[1];
    args = args.slice(2);
  }
  const [command, ...rest] = args;
  try {
    if (command === 'help' || command === '--help' || command === '-h') {
      output(usage);
      return 0;
    }
    if (command === 'github') {
      if (selected) throw new WorkError('GitHub commands do not use adapters.');
      output(runGithub(rest, cwd));
      return 0;
    }
    if (!['new', 'add', 'subtask', 'done', 'screenshot', 'show', 'list'].includes(command)) {
      throw new WorkError(command ? `Unknown command "${command}".\n${usage}` : usage);
    }
    const adapter = await loadAdapter(cwd, selected);
    switch (command) {
      case 'new': {
        if (rest.length === 0) throw new WorkError('A title is required.');
        const slug = await adapter.createChange(rest.join(' '));
        if (typeof slug !== 'string' || !slug) throw new WorkError('Adapter returned an invalid change name.');
        output(`Created ${slug}${selected ? ` with ${selected}` : ''}.`);
        break;
      }
      case 'add':
        if (rest.length < 2) throw new WorkError('Usage: spectacles add <change> <task>');
        await adapter.addTask(rest[0], rest.slice(1).join(' '));
        output(`Added task to ${rest[0]}.`);
        break;
      case 'subtask': {
        if (rest.length < 3) throw new WorkError('Usage: spectacles subtask <change> <parent> <text>');
        if (typeof adapter.addSubtask !== 'function') throw new WorkError('Selected adapter does not support subtasks.');
        const id = await adapter.addSubtask(rest[0], rest[1], rest.slice(2).join(' '));
        output(`Added subtask ${id} to ${rest[0]}.`);
        break;
      }
      case 'done':
        if (rest.length < 3) throw new WorkError('Usage: spectacles done <change> <id> <resolution>');
        await adapter.completeTask(rest[0], rest[1], rest.slice(2).join(' '));
        output(`Completed task ${rest[1]} in ${rest[0]}.`);
        break;
      case 'screenshot': {
        if (rest.length < 2 || rest.length > 3) throw new WorkError('Usage: spectacles screenshot <change> <id> [image]');
        if (typeof adapter.attachScreenshot !== 'function') throw new WorkError('Selected adapter does not support screenshots.');
        const attach = (file) => adapter.attachScreenshot(rest[0], rest[1], file);
        const path = rest[2] ? await attach(resolve(cwd, rest[2])) : await withCapturedScreenshot(attach);
        output(`Attached screenshot to ${rest[0]} task ${rest[1]}: ${path}`);
        break;
      }
      case 'show': {
        if (rest.length !== 1) throw new WorkError('Usage: spectacles show <change>');
        const change = validateChange(await adapter.getChange(rest[0]));
        for (const line of formatChange(change)) output(line);
        break;
      }
      case 'list': {
        if (rest.length) throw new WorkError('Usage: spectacles list');
        const changes = await adapter.listChanges();
        if (!Array.isArray(changes)) throw new WorkError('Adapter listChanges must return an array.');
        if (!changes.length) output('No changes yet. Run: spectacles new "My idea"');
        for (const item of changes) {
          const change = validateChange(item);
          output(`${change.slug}  ${progress(change)}  ${change.title}`);
        }
        break;
      }
    }
    return 0;
  } catch (cause) {
    if (!(cause instanceof WorkError)) throw cause;
    error(cause.message);
    return 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = await run(process.argv.slice(2));
}
