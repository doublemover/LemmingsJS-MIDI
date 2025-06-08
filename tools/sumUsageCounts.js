#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export function sumUsageCounts(srcFiles, destFile) {
  const total = {};
  for (const file of srcFiles) {
    if (!file || !fs.existsSync(file)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const [k, v] of Object.entries(data)) {
        total[k] = (total[k] || 0) + (typeof v === 'number' ? v : 0);
      }
    } catch {
      // ignore invalid JSON
    }
  }
  fs.mkdirSync(path.dirname(destFile), { recursive: true });
  fs.writeFileSync(destFile, JSON.stringify(total) + '\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const dest = args.pop() || '.repoMetrics/usageCounts.json';
  sumUsageCounts(args, dest);
}
