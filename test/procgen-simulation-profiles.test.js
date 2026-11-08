import { expect } from 'chai';
import { procgenSimulationProfile } from '../js/app/procgen/ProcgenSimulationProfiles.js';
import { validateSimulationManifest, encodeSimulationPacket, decodeSimulationPacket } from '../js/app/procgen/ProcgenSimulationProtocol.js';
import { createResourceBudget } from '../js/app/resources/ResourceBudget.js';
import { encodeBackgroundSnapshotPages } from '../js/app/resources/BackgroundSnapshotPages.js';

describe('bounded single-lane independent simulation profile (#1291)', () => {
  it('admits the documented simultaneous source/output/viewport footprint without raising the default limit', () => {
    const profile = procgenSimulationProfile('single-lane-v1'), budget = createResourceBudget(), baseline = {}, sourceCapsule = {}, worker = {}, viewport = {};
    budget.reserve({ token: baseline, owner: 'existing-paused-source-and-private-output', bytes: 512 * 1048576 - 311156495 - 8454144, category: 'checkpoint' });
    budget.reserve({ token: sourceCapsule, owner: 'physical-source-capsule', bytes: 8454144, category: 'checkpoint' });
    budget.reserve({ token: worker, owner: 'single-lane-worker', bytes: profile.aggregateBytes, category: 'candidate' });
    budget.release({ token: sourceCapsule });
    budget.reserve({ token: viewport, owner: 'paused-and-live-viewports', bytes: 8 * 1048576, category: 'checkpoint' });
    expect(budget.diagnostics().accountedBytes).to.be.lessThan(budget.diagnostics().limitBytes);
    expect(profile.packetBytes).to.equal(2 * 1048576);
    expect(profile.checkpointSemanticPeakBytes).to.equal(16 * 1048576);
    expect(profile.aggregateBytes).to.be.at.least(profile.workerLimitBytes + profile.checkpointPeakBytes);
    for (const token of [viewport, worker, baseline]) budget.release({ token });
    expect(budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('binds the exclusive transfer buffer and decoded byte ceiling to the admitted profile', () => {
    const profile = procgenSimulationProfile('single-lane-v1'), buffer = new ArrayBuffer(profile.packetBytes);
    const packet = { sequence: 1, intents: [], batch: { version: 1, tick: 2, generation: 1, facts: [], snapshot: { tick: 2, generation: 1 } } };
    const bytes = encodeSimulationPacket(packet, buffer, profile.packetBytes);
    expect(decodeSimulationPacket(buffer, bytes, profile.packetBytes)).to.deep.equal(packet);
    expect(() => decodeSimulationPacket(buffer, bytes)).to.throw('transfer lease');
    expect(() => encodeSimulationPacket(packet, new ArrayBuffer(8 * 1048576), profile.packetBytes)).to.throw('pool buffer');
    expect(() => encodeSimulationPacket({ ...packet, text: 'é'.repeat(profile.packetBytes) }, buffer, profile.packetBytes)).to.throw('transfer capacity');
  });
  it('refuses a larger lane source before worker creation', () => {
    const manifest = { schema: 'lemmings-authoritative-simulation/v1', ownerId: 'single-lane', ownerEpoch: 1, documentRevision: 0, resourceProfile: 'single-lane-v1', checkpoint: { version: 2, laneCount: 1 }, semantic: { version: 1 }, rootPath: '/', graph: {}, bpm: 120, playing: true, scoreTimeline: true };
    expect(validateSimulationManifest(manifest)).to.equal(manifest);
    expect(() => validateSimulationManifest({ ...manifest, checkpoint: { ...manifest.checkpoint, laneCount: 2 } })).to.throw('completed world');
    expect(procgenSimulationProfile('compact-v1').maxInputBytes).to.equal(16 * 1048576);
  });
  it('enforces the smaller source byte ceiling instead of silently expanding its clone workspace', async () => {
    const profile = procgenSimulationProfile('single-lane-v1'); let error;
    try { for await (const packet of encodeBackgroundSnapshotPages({ text: 'x'.repeat(profile.maxInputBytes + 1) }, { maxBytes: profile.maxInputBytes, maxNodes: profile.maxInputNodes, estimatedPeakBytes: profile.inputPeakBytes })) void packet; }
    catch (caught) { error = caught; }
    expect(error).to.be.instanceOf(Error);
  });
});
