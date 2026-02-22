#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const mochaBin = require.resolve('mocha/bin/mocha.js');

const CATEGORY_PATTERNS = {
  core: ['test/*game*.test.js'],
  bench: ['test/*bench*.test.js'],
  workflow: ['test/*workflow*.test.js'],
  tools: ['test/tools/*.test.js'],
  'offline-tools': ['test/offline-tools/*.test.js'],
  editor: ['test/editor/*.test.js']
};

function runMocha(args) {
  const res = spawnSync(process.execPath, [mochaBin, ...args], { stdio: 'inherit' });
  if (res.error) {
    console.error(`Failed to run mocha: ${res.error.message}`);
    process.exit(1);
  }
  if (typeof res.status !== 'number') {
    console.error('Mocha exited without a status code.');
    process.exit(1);
  }
  process.exit(res.status);
}

const categories = process.argv.slice(2);

if (categories.length === 0) {
  runMocha(['--recursive']);
}

const patterns = [];
for (const cat of categories) {
  const globs = CATEGORY_PATTERNS[cat];
  if (!globs) {
    console.error(`Unknown category: ${cat}`);
    process.exit(1);
  }
  patterns.push(...globs);
}

runMocha(patterns);
