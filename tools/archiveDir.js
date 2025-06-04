import AdmZip from 'adm-zip';
import * as tar from 'tar';
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

export async function archiveDir(dir, format) {
  const base = path.basename(dir);
  const cwd = path.dirname(dir);
  format = format.toLowerCase();
  if (format === 'zip') {
    const zip = new AdmZip();
    zip.addLocalFolder(dir, base);
    zip.writeZip(`${dir}.zip`);
  } else if (format === 'tar' || format === 'tgz' || format === 'tar.gz') {
    await tar.c({ gzip: true, cwd, file: `${dir}.tar.gz` }, [base]);
  } else if (format === 'rar') {
    const res = spawnSync('rar', ['a', `${base}.rar`, base], { cwd, stdio: 'inherit' });
    if (res.error) throw new Error('rar command failed');
  } else {
    throw new Error(`Unsupported archive format ${format}`);
  }
}
