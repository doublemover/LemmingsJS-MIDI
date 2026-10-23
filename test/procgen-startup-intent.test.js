import { expect } from 'chai';
import { createMidiProject } from '../js/midi/project/MidiProject.js';
import { createProcgenWorkstationProject } from '../js/app/procgen/workstation/ProcgenWorkstationProject.js';
import { resolveProcgenStartupIntent } from '../js/app/procgen/workstation/ProcgenStartupIntent.js';
import { createProcgenRecipeShareDescriptor, createProcgenShareUrl } from '../js/app/procgen/ProcgenUrlConfig.js';

describe('ProcGen startup intent', () => {
  const legacyProject = createProcgenWorkstationProject(createMidiProject(), { seed: 12, lanes: [{}, {}] });
  const saved = { version: 1, project: legacyProject, transport: { bpm: 60, gameSpeed: 0.5, speedMode: 'bpm' } };
  const base = { seed: 91, legacyProject, legacySettings: { laneCount: 8, speed: 3, pack: 2 } };
  it('resolves one portable recipe independently of unrelated saved state', () => {
    const search = '?seed=999&lanes=3&speed=2&pack=4';
    const empty = resolveProcgenStartupIntent({ ...base, search });
    const occupied = resolveProcgenStartupIntent({ ...base, search, saved });
    expect(occupied.mode).to.equal('recipe');
    expect({ ...occupied.project, createdAt: null, updatedAt: null }).to.deep.equal({ ...empty.project, createdAt: null, updatedAt: null });
    expect(occupied.worldOptions).to.deep.equal(empty.worldOptions);
    expect(occupied.worldOptions).to.include({ seed: 999, laneCount: 3, speed: 2, pack: 4 });
    expect(occupied.transport).to.include({ bpm: 120, gameSpeed: 2 });
    expect(occupied.project.procgen.lanes).to.have.length(3);
    expect(occupied.project.procgen.lanes.every(lane => lane.outputId === null)).to.equal(true);
  });
  it('labels previous setup and fresh starts explicitly', () => {
    const previous = resolveProcgenStartupIntent({ ...base, saved });
    expect(previous).to.include({ mode: 'previous-setup' });
    expect(previous.worldOptions).to.include({ seed: 91, laneCount: 2, speed: 0.5 });
    expect(previous.transport).to.include({ bpm: 60, gameSpeed: 0.5 });
    const fresh = resolveProcgenStartupIntent(base);
    expect(fresh).to.include({ mode: 'fresh' }); expect(fresh.worldOptions.laneCount).to.equal(8);
  });
  it('rejects malformed physical recipe values instead of quietly blending preferences', () => {
    for (const search of ['?lanes=3.5', '?lanes=0', '?lanes=', '?speed=not-a-number', '?pack=7', '?seed=', '?laneHeight=nope', '?musicMode=weird', '?preset=unknown'])
      expect(() => resolveProcgenStartupIntent({ ...base, search, saved })).to.throw('Invalid recipe');
    const explicitDefault = resolveProcgenStartupIntent({ ...base, search: '?seed=999&lanes=8' });
    const omitted = resolveProcgenStartupIntent({ ...base, search: '?seed=999' });
    expect(explicitDefault.worldOptions.laneCount).to.equal(omitted.worldOptions.laneCount);
    expect(explicitDefault.provenance.laneCount).to.equal('recipe-url');
    expect(omitted.provenance.laneCount).to.equal('recipe-v1-default');
    expect(() => resolveProcgenStartupIntent({ ...base, search: '?recipe=1&extra=' + 'x'.repeat(2050) }))
      .to.throw('supported size');
  });
  it('round-trips a small recipe without carrying unrelated query or fragment state', () => {
    const url = createProcgenShareUrl({ url: 'https://example.test/procgen.html?debug=1&output=midi#private-draft-marker',
      seed: 999, settings: { laneCount: 3, speed: 2, pack: 4, laneHeight: 144, output: 'midi' },
      camera: { cameraX: 10, cameraY: 20, scale: 3, follow: false }, includeCamera: false });
    const target = new URL(url);
    expect(target.hash).to.equal(''); expect(target.searchParams.get('debug')).to.equal(null);
    expect(target.searchParams.get('output')).to.equal(null); expect(target.searchParams.get('cameraX')).to.equal(null);
    expect(target.searchParams.get('recipe')).to.equal('1');
    const opened = resolveProcgenStartupIntent({ ...base, saved, search: target.search });
    expect(opened.worldOptions).to.include({ seed: 999, laneCount: 3, speed: 2, pack: 4, laneHeight: 144 });
    expect(() => resolveProcgenStartupIntent({ ...base, search: '?recipe=2&seed=999' })).to.throw('Unsupported recipe version');
  });
  it('describes a starting recipe through the canonical launch plan without truncating fields', () => {
    const descriptor = createProcgenRecipeShareDescriptor({ url: 'https://example.test/app/procgen.html?output=midi#private',
      seed: 999, settings: { laneCount: 3, speed: 1.123456789, pack: 4, laneHeight: 144 },
      camera: { cameraX: 500, cameraY: 20, scale: 2, follow: false }, includeCamera: false });
    expect(descriptor).to.include({ schema: 'procgen-recipe-share/v1', scope: 'starting-recipe',
      sourceCompatibility: 'unverified-on-recipient', includesCamera: false });
    expect(descriptor.worldOptions).to.include({ seed: 999, laneCount: 3, speed: 1.123456789, pack: 4, laneHeight: 144 });
    expect(descriptor.omitted).to.include('recorded takes and audio');
    const target = new URL(descriptor.url);
    expect(target.hash).to.equal(''); expect(target.searchParams.get('output')).to.equal(null);
    expect(target.searchParams.get('speed')).to.equal('1.123456789');
    expect(resolveProcgenStartupIntent({ ...base, search: target.search, saved }).worldOptions).to.deep.equal(descriptor.worldOptions);
  });
});
