#!/usr/bin/env node
import fs from 'fs';
import vm from 'vm';

function usage() {
  console.log('Usage: node tools/check-undefined.js <file>');
}

async function main() {
  const [file] = process.argv.slice(2);
  if (!file) {
    usage();
    process.exit(1);
  }
  const code = fs.readFileSync(file, 'utf8');
  try {
    vm.runInNewContext(code, {}, { filename: file });
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}

main();
