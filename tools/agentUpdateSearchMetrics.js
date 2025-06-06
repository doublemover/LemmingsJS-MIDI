#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const METRICS_FILE = '.searchMetrics';

function loadMasterMetrics() {
  const res = spawnSync('git', ['show', `master:${METRICS_FILE}`], { encoding: 'utf8' });
  if (res.status !== 0) return {};
  try {
    return JSON.parse(res.stdout.trim() || '{}');
  } catch {
    console.warn('Warning: unable to parse master .searchMetrics');
    return {};
  }
}

function loadLocalMetrics() {
  if (!existsSync(METRICS_FILE)) return {};
  try {
    return JSON.parse(readFileSync(METRICS_FILE, 'utf8'));
  } catch {
    console.error('Local .searchMetrics is invalid JSON');
    process.exit(1);
  }
}

function mergeMetrics(base, extra) {
  for (const [file, m] of Object.entries(extra)) {
    if (!base[file]) base[file] = { md: 0, code: 0, terms: [] };
    base[file].md += m.md || 0;
    base[file].code += m.code || 0;
    const merged = new Set([...(base[file].terms || []), ...(m.terms || [])]);
    base[file].terms = Array.from(merged);
  }
}

const masterData = loadMasterMetrics();
const localData = loadLocalMetrics();
mergeMetrics(masterData, localData);

let json;
try {
  json = JSON.stringify(masterData);
  JSON.parse(json);
} catch {
  console.error('Merged metrics not valid JSON');
  process.exit(1);
}

writeFileSync(METRICS_FILE, json + '\n');
console.log('Updated .searchMetrics');

