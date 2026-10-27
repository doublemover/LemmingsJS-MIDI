import { expect } from 'chai';
import { buildCircuitWorkshop } from '../../js/app/resources/CircuitWorkshopBuilder.js';
import { CIRCUIT_WORKSHOP_VARIANTS } from '../../js/midi/content/CircuitWorkshopProfile.js';
import { validateDrumKitDefinition, resolveDrumKitStrike, validateDrumKitBinding, verifyDrumKitDecodedSources } from '../../js/midi/content/DrumKitDefinition.js';
import { prepareSoundContentPack } from '../../js/midi/content/SoundContentPack.js';
import { validateSoundContentReference, resolveSoundContentReference } from '../../js/midi/content/SoundContentReference.js';
import { hashData } from '../../js/core/CanonicalData.js';
import { describeNativeInstrumentEngines } from '../../js/app/midi-ui/NativeInstrumentSchema.js';
import { prepareCircuitWorkshopPack } from '../../js/app/midi-ui/CircuitWorkshopPreparation.js';
import { readStagedDrumKit } from '../../js/app/midi-ui/DrumKitReference.js';
import { createSoundContentReader } from '../../js/app/midi-ui/SoundContentReader.js';
import { createResourceBudget } from '../../js/app/resources/ResourceBudget.js';
import { createOwnedResourceReservation } from '../../js/app/resources/OwnedResourceReservation.js';
import { createTestBackgroundJobs } from '../helpers/background-worker.js';

const buildId = 'b'.repeat(64), estimatedPeakBytes = 128 * 1048576;
let descriptors, catalog, options;
const caught = async promise => { try { await promise; } catch (error) { return error; } throw new Error('Expected rejection'); };

describe('original Circuit Workshop prepared-source edition (deferred qualification)', function () {
  this.timeout(120000);
  let built, prepared, reference;
  before(async () => {
    descriptors = await describeNativeInstrumentEngines([{ engineId: 'worklet-sample', engineVersion: 1, artifactHash: 'a'.repeat(64) }]);
    catalog = { state: 'bound-application-engines', executionIdentity: { buildId }, descriptors };
    options = { descriptors, applicationBuildId: buildId, estimatedPeakBytes, yieldControl: async () => {} };
    built = await buildCircuitWorkshop({ variant: 'clean' }, options);
    prepared = await prepareSoundContentPack(built.pack, { engineDescriptors: descriptors });
    const patch = prepared.patches[0];
    reference = { schema: 'lemmings-sound-reference/v1', packHash: prepared.contentHash, patchId: patch.archivedDefinition.id, revision: patch.archivedDefinition.revision,
      definitionHash: patch.definitionHash, engineRequirement: patch.engineRequirement, assetHashes: patch.dependencies, definition: patch.archivedDefinition,
      drumKit: { hash: built.kitHash, definition: built.kit } };
  });
  it('retains all named GM strikes, component counts, source clocks and exact source-data ancestry', async () => {
    const kit = validateDrumKitDefinition(built.kit), patch = prepared.patches[0];
    expect(kit.voices.map(voice => voice.gmNote)).to.have.members([35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50]);
    expect(kit.voices.find(voice => voice.id === 'clap').preparationComponents).to.equal(5);
    expect(kit.voices.every(voice => voice.runtimeChildren === 1 && voice.sourceRate === 48000 && voice.sourceChannels === 1)).to.equal(true);
    expect(patch.dependencies).to.have.members(built.assets.map(asset => asset.sha256)); expect(built.assets).to.have.length(18);
    expect(patch.archivedDefinition.voicePolicy.maxVoices).to.equal(16); expect(validateDrumKitBinding(kit, patch.archivedDefinition)).to.equal(kit);
    for (const voice of kit.voices) {
      const bytes = built.assets.find(asset => asset.sha256 === voice.assetHash).bytes, view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      expect(view.getUint32(24, true)).to.equal(voice.sourceRate); expect(view.getUint16(22, true)).to.equal(1); expect(view.getUint32(40, true) / 2).to.equal(voice.sourceFrames);
      expect(view.getInt16(44, true)).to.equal(0); expect(view.getInt16(bytes.length - 2, true)).to.equal(0);
      const digest = await crypto.subtle.digest('SHA-256', bytes); expect(Buffer.from(digest).toString('hex')).to.equal(voice.assetHash);
    }
    const contract = JSON.parse(new TextDecoder().decode(built.assets.find(asset => asset.sha256 === built.contractHash).bytes));
    expect(contract.producerBuildId).to.equal(buildId); expect(contract.runtimeTarget.artifactHash).to.equal('a'.repeat(64));
    expect(contract.statistics.every(row => row.peak > 0 && row.peak < 0.95 && row.scheduledSourceDelayFrames === 0)).to.equal(true);
    expect(built.pack.redistributionPolicy).to.equal('unknown');
  });
  it('separates local articulation selection from hardware fallback and forbids unsupported source retuning', () => {
    const kit = validateDrumKitDefinition(built.kit), first = resolveDrumKitStrike(kit, { gmNote: 36, intensity01: 0.7, instanceId: 'lane-1' }), second = resolveDrumKitStrike(kit, { gmNote: 35, instanceId: 'lane-2' });
    expect(first.voiceId).to.not.equal(second.voiceId); expect(first.sampleKitId).to.not.equal(second.sampleKitId); expect(first.velocity01).to.equal(0.7);
    const unknown = resolveDrumKitStrike(kit, { gmNote: 81, instanceId: 'lane-1' });
    expect(unknown).to.include({ voiceId: 'rim', gmFallbackNote: 81, pitchCents: 3700, localDisposition: 'named-approximation', semanticSources: 1 });
    expect(() => resolveDrumKitStrike(kit, { gmNote: 42, tuningCents: 1, instanceId: 'lane-1' })).to.throw('does not retune');
    expect(() => resolveDrumKitStrike(structuredClone(kit), { gmNote: 42, instanceId: 'lane-1' })).to.throw('Admit');
    for (const mutate of [kit => kit.chokeGroups[0].scope = 'shared-kit', kit => kit.chokeGroups[0].members.push('missing'), kit => kit.voices[0].gmNote = kit.voices[1].gmNote]) {
      const changed = structuredClone(kit); mutate(changed); expect(() => validateDrumKitDefinition(changed)).to.throw('Drum kit');
    }
  });
  it('rejects saved kit hash, sample tuning, map binding and decoded-clock drift without substitution', async () => {
    const validated = validateSoundContentReference(reference), resolution = await resolveSoundContentReference(validated, { engineDescriptors: descriptors, availableHashes: reference.assetHashes });
    expect(resolution.status).to.equal('ready'); expect(resolution.drumKit.voices).to.have.length(16);
    const changed = structuredClone(reference); changed.drumKit.definition.name += ' altered';
    expect((await caught(resolveSoundContentReference(changed, { engineDescriptors: descriptors, availableHashes: reference.assetHashes }))).code).to.equal('content-mismatch');
    const retuned = structuredClone(reference.definition); retuned.sampleMap.zones[0].tuningCents = 10;
    expect(() => validateDrumKitBinding(built.kit, retuned)).to.throw('fixed source');
    const pins = built.kit.voices.map(voice => ({ isActive: () => true, ref: { contentHash: voice.assetHash, sourceSampleRate: voice.sourceRate, frames: voice.sourceFrames, channels: voice.sourceChannels } }));
    expect(verifyDrumKitDecodedSources(built.kit, pins).voices).to.have.length(16); pins[0].ref.sourceSampleRate = 44100;
    expect(() => verifyDrumKitDecodedSources(built.kit, pins)).to.throw('decoded source clock');
    expect(await hashData(built.kit)).to.equal(built.kitHash);
  });
  it('authors four different immutable finite-source variants with explicit dry or printed room policy', async () => {
    const hashes = new Set([built.contentHash]), firstKick = built.kit.voices.find(voice => voice.gmNote === 36).assetHash;
    for (const variant of Object.keys(CIRCUIT_WORKSHOP_VARIANTS).filter(variant => variant !== 'clean')) {
      const value = await buildCircuitWorkshop({ variant }, options); hashes.add(value.contentHash);
      expect(value.kit.voices.find(voice => voice.gmNote === 36).assetHash).to.not.equal(firstKick);
      expect(value.kit.roomPolicy).to.equal(variant === 'small-room-print' ? 'printed-finite-taps;not-shared-room-send' : 'dry-prepared-source');
    }
    expect(hashes.size).to.equal(4); expect((await caught(buildCircuitWorkshop({ variant: 'missing' }, options))).message).to.include('bounded original variant');
  });
  const setup = ({ unknownRetirement = false, mutate = value => value } = {}) => {
    const budget = createResourceBudget(), background = createTestBackgroundJobs(); let releases = 0, request = null;
    const jobs = { ...background, async compute(spec) {
        if (spec.kind !== 'build-circuit-workshop') return background.compute(spec);
        request = spec; expect(await spec.prepareInput()).to.deep.equal({ variant: 'clean', applicationBuildId: buildId });
        const reservation = createOwnedResourceReservation({ budget, owner: 'fixture-kit-producer', kind: 'retained-original-sources', bytes: 16 * 1048576 });
        return { value: mutate(structuredClone(built)), release() { releases++; if (!unknownRetirement) reservation.release(); }, retirementState: () => ({ phase: unknownRetirement ? 'unknown' : 'released' }) };
      } }, reader = createSoundContentReader({ resourceBudget: budget, jobs });
    return { budget, jobs, reader, get releases() { return releases; }, get request() { return request; }, dispose() { reader.dispose(); background.dispose(); } };
  };
  it('stages complete actual source bytes and preserves typed kit identity after producer retirement', async () => {
    const owner = setup(), result = await prepareCircuitWorkshopPack({ variant: 'clean', ...owner, resourceBudget: owner.budget, getCatalog: async () => catalog });
    expect(owner.releases).to.equal(1); expect(owner.request.estimatedPeakBytes).to.equal(estimatedPeakBytes);
    const kit = await readStagedDrumKit(result.stage, prepared.patches[0].identity, { resourceBudget: owner.budget });
    expect(kit.hash).to.equal(built.kitHash); expect(kit.definition).to.deep.equal(built.kit); expect(result.voices).to.equal(16);
    expect(owner.budget.diagnostics().accountedBytes).to.be.greaterThan(0); result.stage.discard(); owner.dispose(); expect(owner.budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('rejects corrupted payloads before publication and retains overlap when producer retirement is unknown', async () => {
    const corrupted = setup({ mutate(value) { value.assets[0].bytes[50] ^= 1; return value; } });
    expect((await caught(prepareCircuitWorkshopPack({ variant: 'clean', ...corrupted, resourceBudget: corrupted.budget, getCatalog: async () => catalog }))).code).to.equal('content-mismatch');
    expect(corrupted.releases).to.equal(1); expect(corrupted.budget.diagnostics().accountedBytes).to.equal(0); corrupted.dispose();
    const unknown = setup({ unknownRetirement: true });
    const error = await caught(prepareCircuitWorkshopPack({ variant: 'clean', ...unknown, resourceBudget: unknown.budget, getCatalog: async () => catalog }));
    expect(error.retirement.outcome).to.equal('partial'); expect(error.circuitWorkshopOwnership.workspace.isActive()).to.equal(true);
    expect(unknown.budget.diagnostics().accountedBytes).to.be.at.least(48 * 1048576); unknown.dispose();
  });
  it('rejects cancellation or an unavailable application before submitting expensive preparation', async () => {
    const owner = setup(), abort = new AbortController(); abort.abort();
    expect((await caught(prepareCircuitWorkshopPack({ variant: 'clean', ...owner, resourceBudget: owner.budget, signal: abort.signal, getCatalog: async () => catalog }))).name).to.equal('AbortError');
    expect((await caught(prepareCircuitWorkshopPack({ variant: 'clean', ...owner, resourceBudget: owner.budget, getCatalog: async () => ({ state: 'unavailable' }) }))).code).to.equal('circuit-workshop-preparation-unavailable');
    expect(owner.request).to.equal(null); expect(owner.budget.diagnostics().accountedBytes).to.equal(0); owner.dispose();
  });
});
