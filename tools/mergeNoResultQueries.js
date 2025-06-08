#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { updateUsageCounts } from './updateUsageCounts.js';

export function mergeNoResultQueries(baseFile, targetFile) {
  if (!fs.existsSync(baseFile)) return;
  if (!fs.existsSync(targetFile)) {
    fs.mkdirSync(path.dirname(targetFile), { recursive: true });
    fs.writeFileSync(targetFile, '');
  }
  const baseLines = fs.readFileSync(baseFile, 'utf8').split(/\r?\n/).filter(Boolean);
  const targetLines = fs.readFileSync(targetFile, 'utf8').split(/\r?\n/).filter(Boolean);
  const seen = new Set(targetLines);
  for (const line of baseLines) {
    if (!seen.has(line)) {
      targetLines.push(line);
      seen.add(line);
    }
  }
  const out = targetLines.join('\n');
  fs.writeFileSync(targetFile, out + (out ? '\n' : ''));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const base = process.argv[2] || 'base_no_results';
  const dest = process.argv[3] || '.searchMetrics/noResultQueries';
  mergeNoResultQueries(base, dest);
  updateUsageCounts('merge_no_result_queries');
}
