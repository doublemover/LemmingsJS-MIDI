import assert from 'assert';

import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/BinaryReader.js';
import '../js/UnpackFilePart.js';
import { FileContainer } from '../js/FileContainer.js';

class MockLogHandler {
  constructor() { this.logged = []; }
  log(msg) { this.logged.push(msg); }
  debug() {}
}

describe('FileContainer.read errors', function () {
  let origLog;
  beforeEach(function () {
    origLog = Lemmings.LogHandler;
    Lemmings.LogHandler = MockLogHandler;
  });

  afterEach(function () {
    Lemmings.LogHandler = origLog;
  });

  it('handles invalid part size', function () {
    const header = Uint8Array.from([
      0, 0, 0, 0, 0, 0, 0, 0, 0, 8
    ]);
    const buf = new Uint8Array(header.length + 2);
    buf.set(header, 0);
    const br = new Lemmings.BinaryReader(buf, 0, buf.length, 'bad.dat');
    const fc = new FileContainer(br);
    assert.strictEqual(fc.count(), 0);
    assert.ok(fc.log.logged.some(m => m.includes('out of sync bad.dat')));
  });
});
