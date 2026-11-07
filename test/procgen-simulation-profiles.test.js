import { expect } from 'chai';
import { procgenSimulationProfile } from '../js/app/procgen/ProcgenSimulationProfiles.js';
import { validateSimulationManifest } from '../js/app/procgen/ProcgenSimulationProtocol.js';
import { createResourceBudget } from '../js/app/resources/ResourceBudget.js';
import { encodeBackgroundSnapshotPages } from '../js/app/resources/BackgroundSnapshotPages.js';

describe('bounded single-lane independent simulation profile (#1291)', () => {
  it('admits the documented simultaneous source/output/viewport footprint without raising the default limit', () => {
    const profile = procgenSimulationProfile('single-lane-v1'), budget = createResourceBudget(), baseline = {}, worker = {}, viewport = {};
    budget.reserve({ token: baseline, owner: 'existing-paused-source-and-private-output', bytes: 512 * 1048576 - 311156495, category: 'checkpoint' });
    budget.reserve({ token: worker, owner: 'single-lane-worker', bytes: profile.aggregateBytes, category: 'candidate' });
    budget.reserve({ token: viewport, owner: 'paused-and-live-viewports', bytes: 8 * 1048576, category: 'checkpoint' });
    expect(budget.diagnostics().accountedBytes).to.be.lessThan(budget.diagnostics().limitBytes);
    expect(profile.aggregateBytes).to.be.at.least(profile.workerLimitBytes + profile.checkpointPeakBytes);
    for (const token of [viewport, worker, baseline]) budget.release({ token });
    expect(budget.diagnostics().accountedBytes).to.equal(0);
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
