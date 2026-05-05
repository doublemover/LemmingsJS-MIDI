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
      '--history-ticks=4',
      '--history-seek-window=2',
      '--terrain-iterations=10',
      '--terrain-clear-iterations=2',
      '--terrain-dig-iterations=2',
      '--object-iterations=1',
      '--minimap-iterations=5',
      '--gamepad-iterations=5',
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
    expect(summary).to.have.property('historyReplayDelta');
    expect(summary).to.have.property('terrainMasks');
    expect(summary).to.have.property('tileComposition');
    expect(summary).to.have.property('overlayPlane');
    expect(summary).to.have.property('scaledBlit');
    expect(summary).to.have.property('objectCulling');
    expect(summary).to.have.property('minimapIdle');
    expect(summary).to.have.property('gamepadIdle');
    expect(summary).to.have.property('midiRouter');
    expect(summary).to.have.property('midiScheduler');
    expect(summary.historyReplayDelta.lemmings50.endTick.avgMs).to.be.a('number');
    expect(summary.terrainMasks.clearGroundWithMaskCount.historyRecords).to.be.a('number');
    expect(summary.tileComposition.avgMs).to.be.a('number');
    expect(summary.tileComposition.p95Ms).to.be.a('number');
    expect(summary.tileComposition.worstMs).to.be.a('number');
    expect(summary.overlayPlane.avgMs).to.be.a('number');
    expect(summary.overlayPlane.p99Ms).to.be.a('number');
    expect(summary.scaledBlit.avgMs).to.be.a('number');
    expect(summary.scaledBlit.allocBytesAvg).to.be.a('number');
    expect(summary.objectCulling.viewport1000.avgMs).to.be.a('number');
    expect(summary.minimapIdle.pausedIdle.drawCalls).to.be.a('number');
    expect(summary.gamepadIdle.getGamepadsCalls).to.be.a('number');
    expect(summary.midiRouter.avgMs).to.be.a('number');
    expect(summary.midiScheduler.avgMs).to.be.a('number');
  });
});
