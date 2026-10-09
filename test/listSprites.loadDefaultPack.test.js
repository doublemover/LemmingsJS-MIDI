import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadDefaultPack } from '../tools/listSprites.js';

const withTempDir = (fn) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

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
