import { expect } from 'chai';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const parseJsonOutput = (stdout) => {
  const text = String(stdout || '').trim();
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first < 0 || last <= first) return null;
  return JSON.parse(text.slice(first, last + 1));
};

describe('bench-hotpaths script', () => {
  it('reports midi router and scheduler throughput sections', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const script = path.join(root, 'scripts', 'bench-hotpaths.js');
    const result = spawnSync(process.execPath, [
      script,
      '--repeats=1',
      '--dirty-iterations=10',
      '--dirty-rects=1',
      '--tile-iterations=10',
      '--tile-per-iter=1',
      '--ants-iterations=10',
      '--gui-iterations=5',
      '--overlay-iterations=5',
      '--scaled-iterations=10',
      '--midi-router-iterations=10',
      '--midi-router-events=4',
      '--midi-scheduler-iterations=10',
      '--midi-scheduler-notes=4'
    ], {
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024
    });
    expect(result.status).to.equal(0);
    const summary = parseJsonOutput(result.stdout);
    expect(summary).to.be.an('object');
    expect(summary).to.have.property('tileComposition');
    expect(summary).to.have.property('overlayPlane');
    expect(summary).to.have.property('scaledBlit');
    expect(summary).to.have.property('midiRouter');
    expect(summary).to.have.property('midiScheduler');
    expect(summary.tileComposition.avgMs).to.be.a('number');
    expect(summary.overlayPlane.avgMs).to.be.a('number');
    expect(summary.scaledBlit.avgMs).to.be.a('number');
    expect(summary.midiRouter.avgMs).to.be.a('number');
    expect(summary.midiScheduler.avgMs).to.be.a('number');
  });
});
