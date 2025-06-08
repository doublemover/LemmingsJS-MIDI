#!/usr/bin/env node
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  statSync,
  unlinkSync
} from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const COUNTS_FILE = path.join('.repoMetrics', 'usageCounts.json');
mkdirSync(path.dirname(COUNTS_FILE), { recursive: true });

function parseCounts(data, label) {
  data = (data || '').trim();
  if (!data) return {};
  try {
    return JSON.parse(data);
  } catch {
    if (label) console.warn(`Warning: unable to parse ${label} usageCounts`);
    return {};
  }
}

function loadMasterCounts() {
  const res = spawnSync('git', ['show', `master:${COUNTS_FILE}`], { encoding: 'utf8' });
  if (res.status !== 0) return {};
  return parseCounts(res.stdout, 'master');
}

function loadLocalCounts() {
  if (!existsSync(COUNTS_FILE)) return {};
  const data = readFileSync(COUNTS_FILE, 'utf8');
  const parsed = parseCounts(data, 'local');
  if (Object.keys(parsed).length === 0 && data.trim()) {
    console.error('Local usageCounts invalid JSON');
    process.exit(1);
  }
  return parsed;
}

function mergeCounts(base, extra) {
  for (const [key, value] of Object.entries(extra)) {
    base[key] = (base[key] || 0) + (value || 0);
  }
}

const masterData = loadMasterCounts();
const localData = loadLocalCounts();
mergeCounts(masterData, localData);

let json;
try {
  json = JSON.stringify(masterData);
  JSON.parse(json);
} catch {
  console.error('Merged usage counts not valid JSON');
  process.exit(1);
}

if (existsSync('.repoMetrics') && !statSync('.repoMetrics').isDirectory()) {
  unlinkSync('.repoMetrics');
}
mkdirSync('.repoMetrics', { recursive: true });
writeFileSync(COUNTS_FILE, json + '\n');
console.log('Updated .repoMetrics usageCounts');
