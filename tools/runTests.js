#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const res = spawnSync('mocha', process.argv.slice(2), { stdio: 'inherit' });
process.exit(res.status);
