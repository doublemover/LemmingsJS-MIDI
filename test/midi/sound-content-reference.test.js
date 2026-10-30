import { expect } from 'chai';
import { soundFixture } from '../helpers/sound-content.js';
import { hashData } from '../../js/core/CanonicalData.js';
import { validateSoundContentReference, resolveSoundContentReference, getSupportedInstrumentDefinition } from '../../js/midi/content/SoundContentReference.js';
import { createProcgenLane } from '../../js/app/procgen/workstation/ProcgenWorkstationProject.js';
import { generatePatchNeighborhood } from '../../js/midi/content/PatchNeighborhood.js';
import { revisePatchCandidate } from '../../js/midi/content/PatchForkRevision.js';

describe('saved immutable lane instrument definitions', () => {
  let fixture, reference;
  before(async () => {
    fixture = await soundFixture(); const patch = fixture.prepared.patches[0];
    reference = { schema: 'lemmings-sound-reference/v1', packHash: fixture.prepared.contentHash, patchId: patch.archivedDefinition.id,
      revision: patch.archivedDefinition.revision, definitionHash: patch.definitionHash, engineRequirement: patch.engineRequirement,
      assetHashes: patch.dependencies, definition: patch.archivedDefinition };
  });
  it('keeps exact definitions through lane creation without resolving display names or changing musical edits', async () => {
    const lane = createProcgenLane(0, { name: 'User name', gain: 0.37, instrumentRef: reference });
    expect(lane.instrumentRef.definition.id).to.equal(reference.patchId); expect(lane.gain).to.equal(0.37); expect(lane.name).to.equal('User name');
    expect(Object.isFrozen(lane.instrumentRef.definition.parameters)).to.equal(true);
    expect(validateSoundContentReference(lane.instrumentRef)).to.equal(lane.instrumentRef);
    expect(getSupportedInstrumentDefinition(lane.instrumentRef)).to.equal(lane.instrumentRef.definition);
    const restored = createProcgenLane(0, JSON.parse(JSON.stringify(lane)));
    const resolution = await resolveSoundContentReference(restored.instrumentRef, { engineDescriptors: [fixture.engine], availableHashes: [fixture.sha256] });
    expect(resolution.status).to.equal('ready'); expect(resolution.reference.definitionHash).to.equal(reference.definitionHash);
  });
  it('preserves future definitions and missing engine/material requirements without substituting another instrument', async () => {
    const missing = await resolveSoundContentReference(reference); expect(missing.status).to.equal('engine-unavailable');
    const material = await resolveSoundContentReference(reference, { engineDescriptors: [fixture.engine] }); expect(material.status).to.equal('asset-missing');
    const future = structuredClone(reference); future.definition.schemaVersion = 99; future.definitionHash = await hashData(future.definition);
    const lane = createProcgenLane(0, { instrumentRef: future });
    expect((await resolveSoundContentReference(lane.instrumentRef)).status).to.equal('patch-schema-unavailable');
    expect(lane.instrumentRef.definition.schemaVersion).to.equal(99);
    future.definition.macros = { futureOnly: ['opaque', 99] }; future.definition.variation = { futureOnly: true }; future.definition.causalBindings = { futureOnly: true };
    future.definitionHash = await hashData(future.definition);
    const opaque = createProcgenLane(0, { instrumentRef: future });
    const reopened = createProcgenLane(0, JSON.parse(JSON.stringify(opaque)));
    expect(reopened.instrumentRef).to.deep.equal(opaque.instrumentRef);
    expect((await resolveSoundContentReference(reopened.instrumentRef)).status).to.equal('patch-schema-unavailable');
    expect(getSupportedInstrumentDefinition(reopened.instrumentRef)).to.equal(null);
  });
  it('rejects altered pinned bytes and mismatched identities before backend admission', async () => {
    const changed = structuredClone(reference); changed.definition.name = 'Changed without a new hash'; let error;
    try { await resolveSoundContentReference(changed, { engineDescriptors: [fixture.engine], availableHashes: [fixture.sha256] }); } catch (failure) { error = failure; }
    expect(error.code).to.equal('content-mismatch');
    const wrong = structuredClone(reference); wrong.patchId = 'different'; expect(() => createProcgenLane(0, { instrumentRef: wrong })).to.throw('complete immutable patch');
    const engine = { ...fixture.engine, artifactHash: 'c'.repeat(64) };
    expect((await resolveSoundContentReference(reference, { engineDescriptors: [engine] })).status).to.equal('engine-revision-mismatch');
  });
  it('refuses future parent schemas before neighborhood or explicit candidate editing', async () => {
    const future = structuredClone(reference); future.definition.schemaVersion = 99; future.definition.macros = { opaque: true }; future.definitionHash = await hashData(future.definition);
    let compiled = 0;
    for (const work of [() => generatePatchNeighborhood({ prepared: fixture.prepared, reference: future, descriptor: fixture.engine, compile: () => { compiled++; } }),
      () => revisePatchCandidate({ candidate: { state: 'compiled', compiled: { prepared: fixture.prepared }, name: 'Future', reference: future }, descriptor: fixture.engine, compile: () => { compiled++; } })]) {
      let error; try { await work(); } catch (failure) { error = failure; } expect(error?.code).to.equal('unsupported-parent-schema');
    }
    expect(compiled).to.equal(0); expect(future.definition.schemaVersion).to.equal(99);
  });
});
