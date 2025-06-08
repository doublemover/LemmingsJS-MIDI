#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export function updateUsageCounts(key) {
  if (!key) return;
  const file = path.join('.repoMetrics', 'usageCounts.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    data = {};
  }
  data[key] = (data[key] || 0) + 1;
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  updateUsageCounts(process.argv[2]);
}
