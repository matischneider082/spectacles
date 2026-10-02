import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createAdapter as createMarkdownAdapter } from './markdown.js';
import { WorkError } from '../work.js';

const packageName = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const adapterMethods = ['createChange', 'addTask', 'completeTask', 'getChange', 'listChanges'];

function readConfig(cwd) {
  const path = join(cwd, '.spectacles.json');
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
  let config;
  try {
    config = JSON.parse(text);
  } catch (error) {
    throw new WorkError(`Invalid .spectacles.json: ${error.message}`);
  }
  if (!config || Array.isArray(config) || typeof config !== 'object') {
    throw new WorkError('.spectacles.json must be an object.');
  }
  if (config.defaultAdapter !== undefined && (typeof config.defaultAdapter !== 'string' || !config.defaultAdapter)) {
    throw new WorkError('defaultAdapter must be a nonempty string.');
  }
  if (config.adapters !== undefined && (!config.adapters || Array.isArray(config.adapters) || typeof config.adapters !== 'object')) {
    throw new WorkError('adapters must be an object.');
  }
  const unknown = Object.keys(config).filter((key) => !['defaultAdapter', 'adapters'].includes(key));
  if (unknown.length) throw new WorkError(`Unknown .spectacles.json setting: ${unknown.join(', ')}.`);
  return config;
}

export async function loadAdapter(cwd, selected) {
  const config = readConfig(cwd);
  const name = selected ?? config.defaultAdapter ?? 'markdown';
  if (name === 'markdown') return createMarkdownAdapter({ cwd });
  const entry = Object.hasOwn(config.adapters ?? {}, name) ? config.adapters[name] : undefined;
  if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
      typeof entry.package !== 'string' || !packageName.test(entry.package)) {
    throw new WorkError(`Adapter "${name}" requires a valid package entry in .spectacles.json.`);
  }
  const unknown = Object.keys(entry).filter((key) => !['package', 'options'].includes(key));
  if (unknown.length) throw new WorkError(`Unknown setting for adapter "${name}": ${unknown.join(', ')}.`);
  if (entry.options !== undefined && (!entry.options || typeof entry.options !== 'object' || Array.isArray(entry.options))) {
    throw new WorkError(`Adapter "${name}" options must be an object.`);
  }

  // Resolve from the user's project, not from Spectacles' installation directory.
  const require = createRequire(join(cwd, 'package.json'));
  let resolved;
  try {
    resolved = require.resolve(entry.package);
  } catch (error) {
    if (error.code === 'MODULE_NOT_FOUND') {
      throw new WorkError(`Cannot resolve adapter package "${entry.package}" from ${cwd}. Install it in this project.`);
    }
    throw error;
  }
  const module = await import(pathToFileURL(resolved).href);
  if (typeof module.createAdapter !== 'function') {
    throw new WorkError(`Adapter package "${entry.package}" must export createAdapter.`);
  }
  const adapter = await module.createAdapter({ cwd, options: entry.options ?? {} });
  if (!adapter || adapterMethods.some((method) => typeof adapter[method] !== 'function')) {
    throw new WorkError(`Adapter "${name}" must implement ${adapterMethods.join(', ')}.`);
  }
  return adapter;
}
