import { expect } from 'chai';
import { validateProcgenSession } from '../js/app/procgen/workstation/ProcgenSessionStorage.js';
import { createSeededImportCorpus, mutateImportSession, IMPORT_CORPUS_SEED } from '../e2e/helpers/seededImportCorpus.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { captureProcgenCheckpoint, restoreProcgenCheckpoint } from '../js/app/procgen/workstation/ProcgenCheckpoint.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';

describe('bounded session envelope and container admission', () => {
  it('refuses the reproducible generated corpus before changing executable world owners', async () => {
    const world = new ProcgenLaneWorld({ masks: await loadProcgenMasks(), assists: false });
    try {
      const checkpoint = captureProcgenCheckpoint(world), original = { format: 'lemmings-procgen-session', version: 1, project: {}, settings: {}, world: checkpoint,
        transport: {}, patterns: { version: 1, beat: 0, lanes: {}, pending: [], active: [] } };
      expect(validateProcgenSession(original)).to.equal(original);
      const corpus = createSeededImportCorpus(); expect(corpus).to.have.length(64); expect(corpus).to.deep.equal(createSeededImportCorpus({ seed: IMPORT_CORPUS_SEED }));
      expect(new Set(corpus.map(item => item.path.join('.'))).size).to.equal(11);
      for (const item of corpus) {
        const candidate = mutateImportSession(original, item);
        expect(() => { validateProcgenSession(candidate); restoreProcgenCheckpoint(world, candidate.world); }, item.name).to.throw();
        expect(captureProcgenCheckpoint(world), item.name).to.deep.equal(checkpoint);
      }
    } finally { world.dispose(); }
  });
});
