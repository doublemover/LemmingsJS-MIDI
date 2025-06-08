#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

function parseFile(file) {
  if (!fs.existsSync(file)) return [];
  const data = fs.readFileSync(file, 'utf8').replace(/}\s*{/g, '}\n{');
  const lines = data.split(/\r?\n/).filter(Boolean);
  const records = [];
  for (const line of lines) {
    try {
      records.push(JSON.parse(line));
    } catch {
      // ignore malformed JSON
    }
  }
  return records;
}

export function mergeSearchHistory(baseFile, targetFile) {
  const baseRecords = parseFile(baseFile);
  const targetRecords = parseFile(targetFile);
  const seen = new Set(targetRecords.map(r => JSON.stringify(r)));
  for (const rec of baseRecords) {
    const str = JSON.stringify(rec);
    if (!seen.has(str)) {
      targetRecords.push(rec);
      seen.add(str);
    }
  }
  targetRecords.sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  const out = targetRecords.map(r => JSON.stringify(r)).join('\n');
  fs.mkdirSync(path.dirname(targetFile), { recursive: true });
  fs.writeFileSync(targetFile, out + (out ? '\n' : ''));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const base = process.argv[2] || 'base_history';
  const dest = process.argv[3] || '.searchMetrics/searchHistory';
  mergeSearchHistory(base, dest);
}
