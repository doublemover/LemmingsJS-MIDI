import { expect } from 'chai';
import { createMidiProject } from '../js/midi/project/MidiProject.js';
import { createProcgenWorkstationProject } from '../js/app/procgen/workstation/ProcgenWorkstationProject.js';
import { resolveProcgenStartupIntent, parseProcgenStartupIntent, loadProcgenStartupSource } from '../js/app/procgen/workstation/ProcgenStartupIntent.js';
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
    expect(occupied.transport).to.include({ bpm: 120, gameSpeed: 2, speedMode: 'game' });
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
    const incompleteTransport = resolveProcgenStartupIntent({ ...base,
      saved: { ...saved, transport: { bpm: 60, speedMode: 'game' } } });
    expect(incompleteTransport.worldOptions.speed).to.equal(3);
    expect(incompleteTransport.transport).to.include({ bpm: 60, gameSpeed: 3, speedMode: 'game' });
  });
  it('makes an explicit fresh start independent of the previous document and physical preferences', () => {
    const fresh = resolveProcgenStartupIntent({ ...base, saved, search: '?startup=fresh', legacySettings: { laneCount: 2, speed: 0.5, pack: 6, decoration: 'winter' } });
    expect(fresh.mode).to.equal('fresh'); expect(fresh.worldOptions).to.include({ laneCount: 8, speed: 3, pack: 1, decoration: 'none' });
    expect(fresh.project.procgen.lanes).to.have.length(8); expect(Object.isFrozen(fresh.project)).to.equal(true);
    const recipe = resolveProcgenStartupIntent({ ...base, search: '?recipe=1&seed=999', legacySettings: { ...base.legacySettings, decoration: 'winter', workerLimits: { builder: 1 } } });
    expect(recipe.worldOptions.decoration).to.equal('none'); expect(recipe.worldOptions.workerLimits).not.to.deep.equal({ builder: 1 });
    expect(recipe.transport.clockSource).to.equal('internal');
  });
  it('restores document and recovery plans from their artifact and rejects conflicting URL authority', () => {
    const session = { format: 'lemmings-procgen-session', version: 1, name: 'Saved', project: legacyProject,
      world: { seed: 12, laneCount: 2, laneHeight: 144 }, settings: { speed: 0.5, pack: 2, outputId: 'private-device', output: 'midi' },
      transport: { bpm: 60, gameSpeed: 0.5, speedMode: 'bpm', playing: true }, patterns: { version: 1, beat: 0, lanes: {}, pending: [], active: [] } };
    const document = resolveProcgenStartupIntent({ ...base, saved, search: '?startup=document&document=doc%3Afixture&documentRevision=3',
      session, documentIdentity: { id: 'doc:fixture', revision: 3 } });
    expect(document.mode).to.equal('document'); expect(document.worldOptions).to.include({ seed: 12, laneCount: 2, laneHeight: 144 });
    expect(document.worldOptions).not.to.have.property('outputId'); expect(document.transport.playing).to.equal(false);
    expect(document.sourceIdentity).to.deep.equal({ id: 'doc:fixture', revision: 3 });
    expect(resolveProcgenStartupIntent({ ...base, search: '?startup=recovery', session }).mode).to.equal('recovery');
    expect(() => resolveProcgenStartupIntent({ ...base, search: '?startup=document&document=doc%3Afixture&documentRevision=2',
      session, documentIdentity: { id: 'doc:fixture', revision: 3 } })).to.throw('revision changed');
    for (const search of ['?startup=document&document=doc%3Afixture&seed=999', '?startup=recovery&lanes=3', '?startup=fresh&speed=2', '?seed=1&seed=2', '?startup=unknown'])
      expect(() => parseProcgenStartupIntent(search)).to.throw();
  });
  it('loads an explicitly selected source with cancellation before publication', async () => {
    const intent = parseProcgenStartupIntent('?startup=document&document=doc%3Afixture');
    const canceled = new AbortController(); canceled.abort(); let reads = 0, error;
    try { await loadProcgenStartupSource(intent, { signal: canceled.signal, storage: { loadDocument() { reads++; } } }); } catch (failure) { error = failure; }
    expect(error.name).to.equal('AbortError'); expect(reads).to.equal(0);
    const during = new AbortController(); let resolve;
    const loading = loadProcgenStartupSource(intent, { signal: during.signal, storage: { loadDocument() { reads++; return new Promise(done => { resolve = done; }); } } });
    await Promise.resolve(); during.abort();
    try { await loading; } catch (failure) { error = failure; }
    expect(error.name).to.equal('AbortError'); resolve({ id: 'doc:fixture', revision: 1, session: {} });
    expect(reads).to.equal(1);
  });
  it('carries owned startup source lifetime through handoff and releases a late canceled read', async () => {
    const intent = parseProcgenStartupIntent('?startup=document&document=doc%3Afixture'); let released = 0;
    const handle = { id: 'doc:fixture', revision: 1, session: { name: 'owned' }, release() { released++; } };
    const source = await loadProcgenStartupSource(intent, { storage: { loadDocumentOwned: async () => handle } });
    expect(source.session.name).to.equal('owned'); expect(released).to.equal(0); source.release(); source.release(); expect(released).to.equal(1);
    expect(() => source.session).to.throw('released');
    const canceled = new AbortController(); let resolve;
    const pending = loadProcgenStartupSource(intent, { signal: canceled.signal, storage: { loadDocumentOwned: () => new Promise(done => { resolve = done; }) } });
    await Promise.resolve(); canceled.abort(); let error; try { await pending; } catch (failure) { error = failure; }
    expect(error.name).to.equal('AbortError'); resolve(handle); await new Promise(done => setTimeout(done, 0)); expect(released).to.equal(2);
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
    expect(() => resolveProcgenStartupIntent({ ...base, search: '?recipe=1&lanes=3' }))
      .to.throw('requires its seed');
    expect(() => resolveProcgenStartupIntent({ ...base, search: '?seed=999&preset=a&musicPreset=b' }))
      .to.throw('conflicting music presets');
    expect(() => resolveProcgenStartupIntent({ ...base, search: '?seed=999&phrases=perhaps' }))
      .to.throw('Invalid recipe phrases');
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
  it('keeps camera presentation outside physical recipe identity and refuses unsupported scene or camera semantics', () => {
    const options = { url: 'https://example.test/procgen.html?device=private#recovery', seed: 999,
      settings: { laneCount: 3, speed: 2, pack: 4, laneHeight: 192, preset: 'game-lydian-lanterns', mode: 'phrase', decoration: 'old-vegas' },
      camera: { cameraX: 500, cameraY: 20, scale: 2, follow: false } };
    const plain = createProcgenRecipeShareDescriptor({ ...options, includeCamera: false }), framed = createProcgenRecipeShareDescriptor(options);
    expect(framed.recipeIdentity).to.equal(plain.recipeIdentity); expect(framed.camera).to.deep.equal(options.camera); expect(plain.camera).to.deep.equal({});
    expect(resolveProcgenStartupIntent({ ...base, saved, search: new URL(framed.url).search }).worldOptions).to.deep.equal(framed.worldOptions);
    expect(() => createProcgenRecipeShareDescriptor({ ...options, sceneOrigin: { sceneId: 'authored', revision: 1 } })).to.throw('authored scene');
    expect(() => createProcgenRecipeShareDescriptor({ ...options, camera: { ...options.camera, scale: Infinity } })).to.throw('camera framing');
    expect(() => createProcgenRecipeShareDescriptor({ ...options, url: 'https://example.test/' + 'x'.repeat(2100) + '/procgen.html' })).to.throw('URL size');
    for (const field of ['scene', 'sceneId', 'sceneRevision']) expect(() => parseProcgenStartupIntent('?recipe=1&seed=999&' + field + '=missing')).to.throw('scene recipe links are unsupported');
  });
});
