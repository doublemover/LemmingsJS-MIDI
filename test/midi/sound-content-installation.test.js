import { expect } from 'chai';
import fs from 'node:fs/promises';
import { compileSoundContent } from '../../js/midi/content/SoundContentCompiler.js';
import { canonicalDataText } from '../../js/core/CanonicalData.js';
import { describeNativeInstrumentEngines } from '../../js/app/midi-ui/NativeInstrumentSchema.js';
import { createSoundContentReader } from '../../js/app/midi-ui/SoundContentReader.js';
import { createSoundContentInstallation, inspectSoundContentAudition } from '../../js/app/midi-ui/SoundContentInstallation.js';
import { SOUND_ARCHIVE_FORMAT, SOUND_ARCHIVE_MAGIC } from '../../js/app/midi-ui/SoundContentArchive.js';
import { createBackgroundJobService } from '../../js/app/resources/BackgroundJobService.js';
import { createBackgroundWorkerAdmission } from '../../js/app/resources/BackgroundWorkerAdmission.js';
import { createResourceBudget } from '../../js/app/resources/ResourceBudget.js';
import { createProcgenRetirementScope } from '../../js/app/procgen/ProcgenRetirement.js';

const rejects = async (promise, code) => { let error; try { await promise; } catch (failure) { error = failure; } expect(error?.code).to.equal(code); return error; };
describe('staged sound installation and isolated audition authority', () => {
  let archive, descriptors;
  const identity = 'foundation.soft-triangle@2';
  before(async () => {
    descriptors = await describeNativeInstrumentEngines(['native-oscillator', 'worklet-sine'].map(engineId => ({ engineId, engineVersion: 1, artifactHash: 'a'.repeat(64) })));
    const source = JSON.parse(await fs.readFile(new URL('../../content/sounds/native.json', import.meta.url), 'utf8'));
    const output = await compileSoundContent(source, { targets: descriptors.map(descriptor => ({ descriptor })) });
    const header = new TextEncoder().encode(canonicalDataText({ format: SOUND_ARCHIVE_FORMAT, mode: 'reference-only', contentHash: output.prepared.contentHash,
      pack: output.prepared.pack, payloads: [], rightsReview: [], qualification: 'verified-material-not-render-qualified' }).text);
    const prefix = new Uint8Array(12); prefix.set(new TextEncoder().encode(SOUND_ARCHIVE_MAGIC)); new DataView(prefix.buffer).setUint32(8, header.length, false);
    archive = new Blob([prefix, header]);
  });
  const setup = async ({ cleanupFailure = false } = {}) => {
    const budget = createResourceBudget(), admission = createBackgroundWorkerAdmission(), jobs = createBackgroundJobService({ admission, Worker: null, yieldTask: async () => {} });
    const reader = createSoundContentReader({ resourceBudget: budget, jobs }), stage = await reader.stageArchive(archive, { engineDescriptors: descriptors });
    let clock = 0, commits = 0; const calls = [], context = { state: 'running', sampleRate: 48000, get currentTime() { clock += 0.5; return clock; } };
    const backend = { prepare: async () => ({ status: 'ready' }), registerExecution: request => ({ status: 'accepted', execution: Object.freeze(request) }),
      renewExecutionLease: () => ({ status: 'accepted' }), begin: intent => { expect(intent).to.include({ version: 1, kind: 'begin' }); calls.push('begin'); return { status: 'accepted' }; },
      update: () => { calls.push('update'); return { status: 'accepted' }; }, end: () => { calls.push('end'); return { status: 'accepted' }; },
      retireExecution: () => { calls.push('execution-retired'); return { status: 'accepted' }; },
      dispose: () => createProcgenRetirementScope().retire([{ name: 'native', run: () => { calls.push('backend-retired'); if (cleanupFailure) throw new Error('unknown native stop'); } }]) };
    const audio = { getAudioContext: () => context, createSession: () => ({ enable: async () => { calls.push('enabled'); return true; },
      createInstrumentBackend: () => backend, stop: () => { calls.push('audition-owner-stopped'); }, dispose: () => { calls.push('session-retired'); } }) };
    const registry = { commitStage: async () => { commits++; return { state: 'committed', contentHash: stage.metadata().contentHash }; } };
    const installation = createSoundContentInstallation({ audio, registry, getCatalog: async () => ({ state: 'bound-application-engines', descriptors }) });
    return { stage, installation, calls, budget, get commits() { return commits; }, async dispose() { installation.dispose(); stage.discard(); reader.dispose(); jobs.dispose(); admission.dispose(); } };
  };
  it('requires a locally owned audition before install and a separate exact-patch authorization before Apply', async () => {
    const owner = await setup();
    try {
      await rejects(owner.installation.install(owner.stage), 'audition-required'); expect(owner.commits).to.equal(0);
      const receipt = await owner.installation.audition(owner.stage, identity);
      expect(receipt).to.include({ status: 'control-fixture-completed', physicalTakeEvidence: false, acousticReceipt: false });
      expect(owner.calls.slice(0, 5)).to.deep.equal(['enabled', 'begin', 'update', 'update', 'end']);
      expect(inspectSoundContentAudition(receipt, { contentHash: owner.stage.metadata().contentHash, patchIdentity: identity })).not.to.equal(null);
      expect(inspectSoundContentAudition(structuredClone(receipt), { contentHash: owner.stage.metadata().contentHash, patchIdentity: identity })).to.equal(null);
      expect(() => owner.installation.applyCandidate(owner.stage, identity)).to.throw('Commit this staged pack');
      await owner.installation.install(owner.stage); const candidate = owner.installation.applyCandidate(owner.stage, identity);
      expect(candidate.reference.patchId).to.equal('foundation.soft-triangle'); expect(candidate.laneApplication).to.equal('not-requested');
      expect(() => owner.installation.applyCandidate(owner.stage, 'foundation.short-square@2')).to.throw('Audition this exact patch');
    } finally { await owner.dispose(); }
    expect(owner.budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('attempts all cleanup leaves and preserves source ownership when native retirement fails', async () => {
    const owner = await setup({ cleanupFailure: true });
    await rejects(owner.installation.audition(owner.stage, identity), 'retirement-unknown');
    expect(owner.calls).to.include.members(['backend-retired', 'session-retired', 'execution-retired', 'audition-owner-stopped']);
    expect(owner.installation.diagnostics().unknownRetirement).to.equal(1); owner.stage.discard();
    expect(owner.budget.diagnostics().accountedBytes).to.be.greaterThan(0);
    await rejects(owner.installation.audition(owner.stage, identity), 'audition-busy');
    expect((await owner.installation.dispose().completion).outcome).to.equal('partial'); await owner.dispose();
  });
});
