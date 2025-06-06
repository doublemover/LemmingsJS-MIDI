import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

function setupTemp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hqx-'));
  const origPath = new URL('../js/vendor/hqx/index.js', import.meta.url);
  const code = fs.readFileSync(fileURLToPath(origPath), 'utf8')
    .replace('./squooshhqx.js', './squooshhqx.stub.js')
    .replace('./squooshhqx_bg.js', './squooshhqx_bg.stub.js');
  fs.writeFileSync(path.join(dir, 'index.js'), code);
  fs.writeFileSync(path.join(dir, 'squooshhqx.stub.js'), 'export const calls={initSync:0,resize:[]};\nexport function initSync(b){calls.initSync++;calls.bytes=b;}\nexport function resize(buf,w,h,f){calls.resize.push([buf,w,h,f]);return \'scaled\';}');
  fs.writeFileSync(path.join(dir, 'squooshhqx_bg.stub.js'), 'export default \'\';');
  return dir;
}

describe('vendor/hqx/index.js', function () {
  it('initializes once and forwards resize args', async function () {
    const dir = setupTemp();
    const indexUrl = pathToFileURL(path.join(dir, 'index.js')).href + `?t=${Date.now()}`;
    const { initHqx, hqxScale } = await import(indexUrl);
    const stub = await import(pathToFileURL(path.join(dir, 'squooshhqx.stub.js')).href);
    initHqx();
    initHqx();
    expect(stub.calls.initSync).to.equal(1);
    const buf = new Uint32Array([1, 2, 3, 4]);
    const result = hqxScale(buf, 2, 2, 3);
    expect(result).to.equal('scaled');
    expect(stub.calls.resize).to.eql([[buf, 2, 2, 3]]);
  });
});
