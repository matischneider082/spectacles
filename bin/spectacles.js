#!/usr/bin/env node
import { run } from '../src/spectacles.js';

run(process.argv.slice(2)).catch(error => {
  console.error(`spectacles: ${error.message}`);
  process.exitCode = 1;
});
