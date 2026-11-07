import { expect } from 'chai';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { captureProcgenCheckpoint } from '../js/app/procgen/workstation/ProcgenCheckpoint.js';
import { migrateProcgenCheckpoint, hashProcgenContinuationCheckpoint } from '../js/app/procgen/workstation/ProcgenCheckpointProvenance.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';

describe('checkpoint migration source frontier', () => {
  let world, checkpoint;
  before(async () => { world = new ProcgenLaneWorld({ masks: await loadProcgenMasks(), assists: false }); checkpoint = captureProcgenCheckpoint(world); });
  after(() => world.dispose());
  it('refuses future schema, numeric and component codecs before cloning graph owners', () => {
    for (const version of [1, 2]) for (const field of ['schema', 'numericEncoding', 'componentCodecs']) {
      const source = { ...structuredClone(checkpoint), version }; let graphReads = 0;
      if (field === 'componentCodecs') source.componentCodecs.worldGraph++;
      else source[field] = 'unknown-future-' + field;
      Object.defineProperty(source, 'graph', { enumerable: true, get() { graphReads++; throw new Error('unsupported graph was read'); } });
      let failure; try { migrateProcgenCheckpoint(source); } catch (error) { failure = error; }
      expect(failure?.code).to.equal('checkpoint-incompatible'); expect(failure?.message).to.include('incompatible source components'); expect(graphReads).to.equal(0);
    }
  });
  it('migrates intact legacy floating data without mutating the source or qualifying an archived realm', async () => {
    const source = structuredClone(checkpoint); source.version = 1; delete source.schema; delete source.numericEncoding; delete source.componentCodecs;
    for (const node of source.graph.nodes) if (['Float32Array', 'Float64Array'].includes(node.type)) node.values = node.values.map(value =>
      value && typeof value === 'object' ? { '-0': -0, '-Infinity': -Infinity, Infinity, NaN }[value.special] : value);
    const before = structuredClone(source), migrated = migrateProcgenCheckpoint(source);
    expect(source).to.deep.equal(before); expect(migrated.provenance).to.include({ fromVersion: 1, toVersion: 2, originalPreserved: true });
    expect(migrated.provenance.inspection.exactQualified).to.equal(false);
    expect(await hashProcgenContinuationCheckpoint(migrated.checkpoint)).to.equal(await hashProcgenContinuationCheckpoint(checkpoint));
    const ambiguous = JSON.parse(JSON.stringify(source)); let failure;
    try { migrateProcgenCheckpoint(ambiguous); } catch (error) { failure = error; }
    expect(failure?.code).to.equal('ambiguous-numeric-state'); expect(source).to.deep.equal(before);
  });
});
