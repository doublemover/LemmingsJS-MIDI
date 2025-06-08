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
const USAGE_FILE = path.join('.repoMetrics', 'usageCounts.json');
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

function loadMasterUsage() {
  const res = spawnSync('git', ['show', `master:${USAGE_FILE}`], { encoding: 'utf8' });
  if (res.status !== 0) return {};
  try { return JSON.parse(res.stdout); } catch { return {}; }
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

function loadLocalUsage() {
  if (!existsSync(USAGE_FILE)) return {};
  try {
    return JSON.parse(readFileSync(USAGE_FILE, 'utf8'));
  } catch {
    console.error('Local usageCounts.json is invalid');
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

function mergeUsage(base, extra) {
  for (const [k, v] of Object.entries(extra)) {
    base[k] = (base[k] || 0) + (v || 0);
  }
}

const masterData = loadMasterMetrics();
const localData = loadLocalMetrics();
mergeMetrics(masterData, localData);

const masterUsage = loadMasterUsage();
const localUsage = loadLocalUsage();
mergeUsage(masterUsage, localUsage);

let json;
try {
  json = JSON.stringify(masterData);
  JSON.parse(json);
} catch {
  console.error('Merged metrics not valid JSON');
  process.exit(1);
}

let usageJson;
try {
  usageJson = JSON.stringify(masterUsage);
  JSON.parse(usageJson);
} catch {
  console.error('Merged usage counts not valid JSON');
  process.exit(1);
}

if (existsSync('.repoMetrics') && !statSync('.repoMetrics').isDirectory()) {
  unlinkSync('.repoMetrics');
}
mkdirSync('.repoMetrics', { recursive: true });
writeFileSync(METRICS_FILE, json + '\n');
writeFileSync(USAGE_FILE, usageJson + '\n');
console.log('Updated .repoMetrics');

