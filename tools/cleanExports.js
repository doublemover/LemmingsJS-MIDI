import fs from 'fs';
import path from 'path';

const base = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const exportsDir = path.join(base, 'exports');
fs.rmSync(exportsDir, { recursive: true, force: true });
for (const entry of fs.readdirSync(base)) {
  if (entry.startsWith('export_')) {
    fs.rmSync(path.join(base, entry), { recursive: true, force: true });
  }
}
console.log('Removed export directories');
