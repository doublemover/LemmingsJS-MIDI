import fs from 'node:fs/promises';
import path from 'node:path';
import { expect } from 'chai';
import {
  DEFAULT_CAPTURE_ROOT,
  normalizeClipRect,
  resolveCaptureOutputDir,
  sanitizeCaptureName
} from '../e2e/helpers/visualCapture.js';

describe('visual capture helper', function() {
  it('sanitizes capture names for disposable file output', function() {
    expect(sanitizeCaptureName(' MIDI panel / left controls ')).to.equal('MIDI-panel-left-controls');
    expect(sanitizeCaptureName('')).to.equal('capture');
  });

  it('validates and clamps clip rectangles to the viewport', function() {
    expect(normalizeClipRect(
      { x: -5, y: 10, width: 25, height: 20 },
      { width: 100, height: 100 }
    )).to.eql({ x: 0, y: 10, width: 20, height: 20 });
    expect(() => normalizeClipRect({ x: 120, y: 0, width: 10, height: 10 }, {
      width: 100,
      height: 100
    })).to.throw(/outside the viewport/);
    expect(() => normalizeClipRect({ x: 0, y: 0, width: 0, height: 10 })).to.throw(/Invalid clip/);
  });

  it('keeps capture output under temp/e2e-captures', async function() {
    const root = path.resolve(DEFAULT_CAPTURE_ROOT);
    const outDir = path.join(root, 'unit-helper');
    await fs.rm(outDir, { recursive: true, force: true });
    const resolved = await resolveCaptureOutputDir(outDir);
    expect(resolved).to.equal(outDir);
    expect(path.relative(root, resolved).startsWith('..')).to.equal(false);
    let threw = false;
    try {
      await resolveCaptureOutputDir(path.resolve('temp', 'outside-captures'));
    } catch (error) {
      threw = /Capture output must stay/.test(error.message);
    }
    expect(threw).to.equal(true);
  });
});
