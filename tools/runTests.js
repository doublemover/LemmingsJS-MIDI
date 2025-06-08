#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const CATEGORY_PATTERNS = {
  core: ['test/*game*.test.js'],
  bench: ['test/bench*.test.js'],
  workflow: ['test/*workflow*.test.js'],
  tools: ['test/tools/*.test.js']
};

const categories = process.argv.slice(2);

if (categories.length === 0) {
  const res = spawnSync('mocha', ['--recursive'], { stdio: 'inherit' });
  process.exit(res.status);
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

const res = spawnSync('mocha', patterns, { stdio: 'inherit' });
process.exit(res.status);
