import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

function patchModule() {
  const origPath = new URL('../tools/listSprites.js', import.meta.url);
  let code = fs.readFileSync(fileURLToPath(origPath), 'utf8');
  code = code.replace(
    'function loadDefaultPack() {',
    'export function loadDefaultPack(cfgPath) {'
  );
  code = code.replace(
    'const cfgPath = path.join(path.dirname(new URL(import.meta.url).pathname), \'..\', \'config.json\');',
    'cfgPath = cfgPath || path.join(path.dirname(new URL(import.meta.url).pathname), \'..\', \'config.json\');'
  );
  const tmp = path.join(path.dirname(fileURLToPath(origPath)), 'listSprites.patched.js');
  fs.writeFileSync(tmp, code);
  return tmp;
}

const withTempDir = (fn) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

let modulePath;
let loadDefaultPack;

before(async function () {
  modulePath = patchModule();
  ({ loadDefaultPack } = await import(pathToFileURL(modulePath).href + `?t=${Date.now()}`));
});

after(function () {
  if (modulePath) {
    fs.rmSync(modulePath, { force: true });
  }
});

describe('loadDefaultPack', function () {
  it('reads path from config file', function () {
    withTempDir((dir) => {
      const cfgFile = path.join(dir, 'config.json');
      fs.writeFileSync(cfgFile, JSON.stringify([{ path: 'foo' }]));
      const result = loadDefaultPack(cfgFile);
      expect(result).to.equal('foo');
    });
  });

  it('returns "lemmings" on missing or invalid config', function () {
    const missing = path.join(os.tmpdir(), 'no-such.json');
    expect(loadDefaultPack(missing)).to.equal('lemmings');

    withTempDir((dir) => {
      const badFile = path.join(dir, 'config.json');
      fs.writeFileSync(badFile, '{');
      expect(loadDefaultPack(badFile)).to.equal('lemmings');
    });
  });
});
