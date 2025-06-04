import fs from 'fs';
import path from 'path';

for (const file of fs.readdirSync('.')) {
  if (/^export_/.test(file) && fs.statSync(file).isDirectory()) {
    fs.rmSync(path.join('.', file), { recursive: true, force: true });
    console.log(`Removed ${file}`);
  }
}
