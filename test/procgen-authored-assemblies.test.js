import { expect } from 'chai';
import { createHash } from 'node:crypto';
import { createAuthoredAssemblyMiner } from '../tools/AuthoredAssemblyMiner.js';
import { validateAuthoredAssemblyCatalogs, selectAuthoredAssemblyCatalog, compileAuthoredAssemblies, fingerprintObjectImages } from '../js/app/procgen/ProcgenAuthoredAssemblies.js';
import { mineTerrainRecipes } from '../tools/mineTerrainRecipes.js';
import { TriggerTypes } from '../js/level/TriggerTypes.js';
const terrainHash = 'a'.repeat(64), objectHash = 'b'.repeat(64);
const image = (width, height, extra = {}) => ({ width, height, frames: [new Uint8Array(width * height)], palette: { data: new Uint32Array(16) }, ...extra });
const art = { assetSha256: terrainHash, objectSha256: objectHash,
  terrain: [image(20, 2), image(2, 2), image(1, 4), image(1, 2)],
  objects: [image(2, 2, { trigger_effect_id: TriggerTypes.TRAP }), image(2, 2, { trigger_effect_id: TriggerTypes.NO_TRIGGER }), image(2, 2)] };
const source = (index = 0, extra = {}) => ({ format: 'classic-dat', pack: 'source', groundSet: 0,
  id: `source/LEVEL000.DAT#${index}`, aliases: [`source/1/${index + 1}`], width: 1600, height: 160, sha256: String(index + 1).repeat(64),
  placements: [{ id: 0, x: 0, y: 3, f: 0 }, { id: 3, x: 5, y: 1, f: 0 }, ...Array.from({ length: 8 }, (_, n) => ({ id: 0, x: 40 + n * 20, y: 80, f: 0 }))],
  objects: [{ id: 0, x: 3, y: 1, f: 0 }, { id: 1, x: 1, y: 1, f: 0 }], ...extra });
const derive = (levels = [source(), source(1)], images = art, config = { path: 'source' }) => {
  const miner = createAuthoredAssemblyMiner([config]); for (const level of levels) miner.observe(level, images); return miner.finish();
};

describe('authored assembly catalog', function() {
  it('learns alpha-linked head/body/support geometry and usage-qualified quarantine without excluding common floors', function() {
    const [catalog] = derive(); validateAuthoredAssemblyCatalogs([catalog]);
    const pair = catalog.entries.find(e => e.placements.length === 2 && e.placements.every(p => p.kind === 'object'));
    expect(pair).to.include({ eligible: true, confidence: 0.9, supportClass: 'object-contact' });
    expect(pair.placements.map(p => p.role)).to.deep.equal(['trap', 'decor']);
    expect(pair.attachments).to.have.length(2);
    expect(pair.supportAnchors.some(a => a.anchor.kind === 'terrain' && a.confidence >= 0.8)).to.equal(true);
    expect(catalog.associatedObjectIds).to.deep.equal([0, 1]);
    expect(catalog.associatedTerrainIds).to.deep.equal([3]);
    const floor = catalog.assetUsage.find(a => a.kind === 'terrain' && a.id === 0);
    expect(floor.sourceUses).to.equal(18); expect(floor.attachmentUseShare).to.be.lessThan(0.2);
    expect(floor.associated).to.equal(false);
    const library = compileAuthoredAssemblies(catalog, art.terrain.map((piece, id) => ({ ...piece, id })), art.objects.map((piece, id) => ({ ...piece, id })));
    const compiled = library.find(item => item.entry.id === pair.id);
    expect(compiled.objects.every(member => member.collision === false)).to.equal(true);
    expect(compiled.terrain).to.have.length(0);
    expect(compiled.supportAnchors[0].anchor).to.include({ collision: true });
    expect(compiled.supportAnchors[0].anchor.pixels).to.be.instanceOf(Uint8Array);
  });

  it('preserves source orientation and distinguishes actual alpha contact from nearby transparent bounding boxes', function() {
    const transparent = image(2, 2); transparent.frames[0].fill(128);
    const emptyArt = { ...art, objects: [art.objects[0], transparent] };
    const [catalog] = derive([source(), source(1)], emptyArt);
    expect(catalog.associatedObjectIds).not.to.include(1);
    expect(catalog.entries.some(e => e.placements.some(p => p.kind === 'object' && p.id === 1))).to.equal(false);
    const flipped = derive([source(0, { objects: [{ id: 0, x: 3, y: 1, f: 2 }, { id: 1, x: 1, y: 1, f: 8 }] }),
      source(1, { objects: [{ id: 0, x: 3, y: 1, f: 2 }, { id: 1, x: 1, y: 1, f: 8 }] })])[0];
    expect(flipped.entries.some(e => e.placements.some(p => p.kind === 'object' && p.f === 8))).to.equal(true);
  });

  it('retains repeated vectors and endcaps as measured geometry without copying full levels', function() {
    const placements = [{ id: 3, x: 9, y: 20, f: 0 }, { id: 1, x: 10, y: 20, f: 0 }, { id: 1, x: 12, y: 20, f: 0 }, { id: 1, x: 14, y: 20, f: 0 }];
    const [catalog] = derive([source(0, { placements, objects: [] }), source(1, { placements, objects: [] })]);
    const endcap = catalog.entries.find(e => e.repeat?.dx === 2 && e.endcap?.side === 'start');
    expect(endcap.placements[endcap.endcap.member].id).to.equal(3);
    expect(catalog.entries.every(e => e.placements.length <= 8 && e.width <= 256 && e.height <= 160)).to.equal(true);
  });

  it('keeps aliases, generated/special/unconfigured/nonclassic inputs and ambiguity out of accepted evidence', function() {
    for (const extra of [{ aliases: [] }, { generated: true }, { graphicSet2: 1 }, { format: 'nxlv' }, { pack: 'foreign' }]) expect(derive([source(0, extra)])).to.deep.equal([]);
    const single = derive([source()])[0];
    expect(single.entries.filter(entry => entry.placements.some(p => p.kind === 'object')).every(entry => !entry.eligible)).to.equal(true);
    expect(single.associatedObjectIds).to.deep.equal([]);
    expect(derive([source(), source()])[0].sourceLevelIds).to.have.length(1);
    expect(() => derive([source(0, { placements: Array(4097).fill({ id: 0 }) })])).to.throw(RangeError);
  });

  it('requires exact pack, terrain, object and optional source revision, and suppresses missing or changed support art', function() {
    const catalog = derive()[0], book = { assemblies: [catalog] }, query = { packPath: 'source', groundSet: 0, assetSha256: terrainHash, objectSha256: objectHash };
    expect(selectAuthoredAssemblyCatalog(book, query)).to.equal(catalog);
    for (const patch of [{ objectSha256: null }, { objectSha256: 'c'.repeat(64) }, { packPath: 'foreign' }, { sourceRevision: 'c'.repeat(64) }]) expect(selectAuthoredAssemblyCatalog(book, { ...query, ...patch })).to.equal(null);
    expect(compileAuthoredAssemblies(catalog, [], [])).to.deep.equal([]);
    const revision = catalog.sourceRevision;
    expect(derive([source(), source(1)], { ...art, objectSha256: 'c'.repeat(64) })[0].sourceRevision).not.to.equal(revision);
    expect(derive([source(), source(1)], art, { path: 'source', changed: true })[0].sourceRevision).not.to.equal(revision);
  });

  it('rejects foreign provenance, malformed graph/member/usage data and unbounded catalog arrays', function() {
    const good = derive()[0];
    const mutate = fn => { const bad = structuredClone(good); fn(bad); return bad; };
    for (const bad of [mutate(c => c.entries[0].sources[0].level = 'foreign/LEVEL000.DAT#0'), mutate(c => c.entries[0].placements[0].f = 32),
      mutate(c => c.entries[0].relations[0].b = 99), mutate(c => c.assetUsage[0].intrinsicUseShare = 2), mutate(c => c.entries = Array(129).fill(c.entries[0]))]) expect(() => validateAuthoredAssemblyCatalogs([bad])).to.throw(TypeError);
  });

  it('fingerprints all object art and trigger metadata with the exact offline byte ordering', async function() {
    const pictures = [image(2, 2, { trigger_effect_id: 4, trigger_left: 0, trigger_top: 1, trigger_width: 2, trigger_height: 1, preview_image_index: 0 })];
    const hash = createHash('sha256');
    for (const object of pictures) { hash.update(JSON.stringify([object.width, object.height, object.trigger_effect_id, object.trigger_left, object.trigger_top, object.trigger_width, object.trigger_height, object.preview_image_index])); for (const frame of object.frames) hash.update(frame); hash.update(new Uint8Array(object.palette.data.buffer)); }
    expect(await fingerprintObjectImages(pictures)).to.equal(hash.digest('hex'));
    pictures[0].trigger_width = 1;
    expect(await fingerprintObjectImages(pictures)).not.to.equal(await fingerprintObjectImages([image(2, 2)]));
    try { await fingerprintObjectImages(Array(17).fill(pictures[0])); throw new Error('Expected bounded failure'); } catch (error) { expect(error).to.be.instanceOf(RangeError); }
  });

  it('mines every configured tile scope deterministically and retains the measured chameleon pair with supported authored variants', async function() {
    this.timeout(20000);
    const book = await mineTerrainRecipes(); validateAuthoredAssemblyCatalogs(book.assemblies);
    expect(book.assemblies).to.have.length(16);
    expect(book.assemblies.reduce((sum, c) => sum + c.sourceLevelIds.length, 0)).to.equal(280);
    expect(book.inventory.failures).to.deep.equal([]);
    const bubble = book.assemblies.find(c => c.pack === 'lemmings_ohNo' && c.groundSet === 3);
    expect(bubble.associatedObjectIds).to.include(8).and.include(10);
    const body = bubble.assetUsage.find(a => a.kind === 'object' && a.id === 10);
    expect(body).to.include({ sourceUses: 3, linkedUses: 3, attachmentUseShare: 1, stableTransforms: 1 });
    const pair = bubble.entries.find(e => e.placements.length === 2 && e.placements.every(p => p.kind === 'object') && e.placements.some(p => p.id === 8) && e.placements.some(p => p.id === 10));
    expect(pair.evidence).to.include({ instances: 3, levels: 3 });
    expect(pair.supportAnchors.some(a => a.confidence === 0.8 && a.confidenceBasis === 'repeated-attachment-family')).to.equal(true);
    expect(Buffer.byteLength(JSON.stringify(book.assemblies))).to.be.lessThan(3000000);
    expect(book.assemblies.every(c => c.entries.length <= 64)).to.equal(true);
  });
});
