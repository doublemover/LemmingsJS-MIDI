import { expect } from 'chai';
import { nativeSoundCandidates } from '../helpers/native-sound-candidates.js';
import { compileSoundContent } from '../../js/midi/content/SoundContentCompiler.js';
import { readFile } from 'node:fs/promises';
import { NATIVE_SOUND_COLLECTIONS, resolveLegacySoundAlias, nativeSoundCollection } from '../../js/app/procgen/workstation/NativeSoundCollections.js';
import { PROCGEN_SOUND_COLLECTIONS } from '../../js/app/procgen/workstation/ProcgenSoundCollections.js';
import { createNativeSoundSelection } from '../../js/app/midi-ui/NativeSoundSelection.js';
import { createResourceBudget } from '../../js/app/resources/ResourceBudget.js';

describe('independent native sound collection aliases', () => {
  it('resolves every retained legacy patch ID to an actual nonabstract native recipe without a world/program edit', async () => {
    const identities = new Set();
    for (const collection of NATIVE_SOUND_COLLECTIONS) { const source = JSON.parse(await readFile(collection.source, 'utf8')); for (const patchId of collection.patchIds) {
      expect(source.recipes.some(recipe => recipe.id === patchId && !recipe.abstract)).to.equal(true); expect(identities.has(patchId)).to.equal(false); identities.add(patchId); expect(nativeSoundCollection(patchId)).to.equal(collection);
    } }
    for (const collection of PROCGEN_SOUND_COLLECTIONS) for (const role of collection.roles) for (const patch of role.patches) {
      const alias = resolveLegacySoundAlias({ family: collection.id, role: role.id, patch: patch.id }); expect(identities.has(alias.patchId)).to.equal(true);
      expect(alias).to.include({ aliasId: patch.id, externalProgramChanged: false, physicalWorldChanged: false }); expect(alias.lanePatch).not.to.have.property('worldThemeId'); expect(alias.lanePatch).not.to.have.property('externalProgram');
    }
    expect(() => resolveLegacySoundAlias({ family: 'unknown' })).to.throw(); expect(() => resolveLegacySoundAlias({ family: 'rock', patch: 'crystal-lead' })).to.throw();
  });
  it('keeps the returned definition charged after retiring worker results and refuses unknown worker retirement', async () => {
    const { descriptors } = await nativeSoundCandidates();
    for (const failRelease of [false, true]) {
      const budget = createResourceBudget(), jobs = { async compute(request) {
          const input = await request.prepareInput(); request.signal.throwIfAborted(); let value;
          if (request.kind === 'parse-json') value = JSON.parse(input);
          else { const compiled = await compileSoundContent(input, { targets: descriptors.map(descriptor => ({ descriptor })) }); value = { pack: compiled.prepared.pack, contentHash: compiled.prepared.contentHash, sourceHash: compiled.sourceHash }; }
          let phase = 'retained-result'; return { get value() { if (phase === 'released') throw new Error('released result read'); return value; }, receipt: { inputBytes: 128 * 1024 },
            release() { if (!failRelease) { phase = 'released'; value = null; } }, retirementState: () => ({ phase }) };
        } }, owner = createNativeSoundSelection({ resourceBudget: budget, jobs, getCatalog: async () => ({ descriptors }), fetch: async url => new globalThis.Response(await readFile(url), { headers: { 'Content-Type': 'application/json' } }) });
      if (failRelease) { let error; try { await owner.prepare('foundation.soft-triangle'); } catch (caught) { error = caught; } expect(error.retirement.outcome).to.equal('partial'); expect(owner.diagnostics().unknownRetirement).to.equal(true); expect(budget.diagnostics().accountedBytes).to.be.greaterThan(0); }
      else { const candidate = await owner.prepare('foundation.soft-triangle'); expect(candidate.reference.patchId).to.equal('foundation.soft-triangle'); expect(budget.diagnostics().accountedBytes).to.equal(Math.ceil(262144 * 1.25)); await candidate.release().completion; expect(budget.diagnostics().accountedBytes).to.equal(0); }
      await owner.dispose().completion;
    }
  });
  it('refuses an unbound engine catalog before reading sound bytes and retires its reservation', async () => {
    const budget = createResourceBudget(); let reads = 0;
    const owner = createNativeSoundSelection({ resourceBudget: budget, fetch: async () => { reads++; }, jobs: { compute() { throw new Error('must not compute'); } }, getCatalog: async () => ({ descriptors: [] }) });
    let error; try { await owner.prepare('foundation.soft-triangle'); } catch (caught) { error = caught; }
    expect(error.message).to.include('immutable'); expect(reads).to.equal(0); await owner.dispose().completion; expect(budget.diagnostics().accountedBytes).to.equal(0);
  });
});
