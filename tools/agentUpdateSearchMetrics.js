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

const METRICS_FILE = path.join('.repoMetrics', 'metrics.json');
mkdirSync(path.dirname(METRICS_FILE), { recursive: true });

function parseMetrics(data, label) {
  data = (data || '').trim();
  if (!data) return {};
  try {
    const parsed = JSON.parse(data);
    return normalizeMetrics(parsed);
  } catch {
    const repaired = data
      .replace(/[\r\n]+/g, '')
      .replace(/\]\s*\[/g, ',');
    try {
      const parsed = JSON.parse(repaired);
      return normalizeMetrics(parsed);
    } catch {
      if (label) console.warn(`Warning: unable to parse ${label} .repoMetrics`);
      return {};
    }
  }
}

function normalizeMetrics(parsed) {
  if (Array.isArray(parsed)) {
    const flat = parsed.flat(Infinity);
    return Object.assign({}, ...flat);
  }
  return parsed || {};
}

function loadMasterMetrics() {
  const res = spawnSync('git', ['show', `master:${METRICS_FILE}`], { encoding: 'utf8' });
  if (res.status !== 0) return {};
  return parseMetrics(res.stdout, 'master');
}

function loadLocalMetrics() {
  if (!existsSync(METRICS_FILE)) return {};
  const data = readFileSync(METRICS_FILE, 'utf8');
  const parsed = parseMetrics(data, 'local');
  if (Object.keys(parsed).length === 0 && data.trim()) {
    console.error('Local .repoMetrics is invalid JSON');
    process.exit(1);
  }
  return parsed;
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

if (existsSync('.repoMetrics') && !statSync('.repoMetrics').isDirectory()) {
  unlinkSync('.repoMetrics');
}
mkdirSync('.repoMetrics', { recursive: true });
writeFileSync(METRICS_FILE, json + '\n');
console.log('Updated .repoMetrics');

