import { expect, test } from '@playwright/test';
import { soundFixture } from '../test/helpers/sound-content.js';

test.use({ permissions: [] });
const setup = async page => {
  const fixture = await soundFixture(), archive = [...new Uint8Array(await fixture.archive().arrayBuffer())];
  await page.route('**/sound-library-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Sound library transaction fixture</title>' }));
  await page.goto('/sound-library-fixture');
  await page.evaluate(async ({ archive, engine, pack }) => {
    const [{ createSoundContentReader }, { createSoundContentRegistry }, { createResourceBudget }, { createBackgroundJobService }, { createBackgroundWorkerAdmission }] = await Promise.all([
      import('/js/app/midi-ui/SoundContentReader.js'), import('/js/app/midi-ui/SoundContentRegistry.js'), import('/js/app/resources/ResourceBudget.js'),
      import('/js/app/resources/BackgroundJobService.js'), import('/js/app/resources/BackgroundWorkerAdmission.js')]);
    const budget = createResourceBudget(), admission = createBackgroundWorkerAdmission(), jobs = createBackgroundJobService({ admission, Worker: null });
    const reader = createSoundContentReader({ resourceBudget: budget, jobs }), registry = createSoundContentRegistry({ resourceBudget: budget });
    const stage = await reader.stageArchive(new Blob([new Uint8Array(archive)]), { engineDescriptors: [engine] });
    window.soundFixture = { budget, admission, jobs, reader, registry, stage, engine, pack, createSoundContentRegistry };
  }, { archive, engine: fixture.engine, pack: fixture.pack });
  return fixture;
};

test('sound installation deduplicates native IndexedDB transactions and preserves archived project material', async ({ page }) => {
  const fixture = await setup(page);
  const installed = await page.evaluate(async () => {
    const f = window.soundFixture;
    const receipts = await Promise.all([f.registry.commitStage(f.stage), f.registry.commitStage(f.stage)]);
    await f.registry.setProjectReference('doc:fixture', f.stage.metadata().contentHash, true);
    const removal = await f.registry.setArchived(f.stage.metadata().contentHash, true);
    const hidden = await f.registry.listPacks(), archivePage = await f.registry.listPacks({ includeArchived: true });
    f.stage.discard(); f.registry.close();
    f.registry = f.createSoundContentRegistry({ resourceBudget: f.budget });
    const saved = await f.registry.loadPack(archivePage.entries[0].id, { engineDescriptors: [f.engine] });
    const hash = saved.prepared.pack.files[0].sha256, asset = await f.registry.loadAsset(hash, 4);
    const bytes = [...new Uint8Array(await asset.blob.arrayBuffer())], id = saved.prepared.contentHash;
    asset.release(); saved.release(); await f.registry.setArchived(id, false);
    const restored = await f.registry.listPacks();
    f.reader.dispose(); f.registry.close(); f.jobs.dispose(); f.admission.dispose();
    return { receipts, removal, hidden: hidden.entries.length, archived: archivePage.entries[0].archived, bytes, restored: restored.entries.length, resources: f.budget.diagnostics().accountedBytes };
  });
  expect(installed.receipts.filter(value => value.deduplicated)).toHaveLength(1);
  expect(installed.receipts.map(value => value.addedAssets).sort()).toEqual([0, 1]);
  expect(installed.removal).toMatchObject({ archived: true, material: 'retained', projectReferences: 'preserved' });
  expect(installed.hidden).toBe(0); expect(installed.archived).toBe(true); expect(installed.restored).toBe(1);
  expect(installed.bytes).toEqual([...fixture.bytes]); expect(installed.resources).toBe(0);
});

test('immutable pack and patch conflicts abort the complete native storage transaction', async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(async () => {
    const f = window.soundFixture;
    const { prepareSoundContentPack } = await import('/js/midi/content/SoundContentPack.js');
    const { canonicalDataText } = await import('/js/core/CanonicalData.js');
    const { SOUND_ARCHIVE_FORMAT, SOUND_ARCHIVE_MAGIC } = await import('/js/app/midi-ui/SoundContentArchive.js');
    const make = async patch => {
      const prepared = await prepareSoundContentPack(patch, { engineDescriptors: [f.engine] });
      const header = new TextEncoder().encode(canonicalDataText({ format: SOUND_ARCHIVE_FORMAT, mode: 'reference-only', contentHash: prepared.contentHash,
        pack: prepared.pack, payloads: [], rightsReview: [], qualification: 'verified-material-not-render-qualified' }).text);
      const prefix = new Uint8Array(12); prefix.set(new TextEncoder().encode(SOUND_ARCHIVE_MAGIC)); new DataView(prefix.buffer).setUint32(8, header.length, false);
      return f.reader.stageArchive(new Blob([prefix, header]), { engineDescriptors: [f.engine] });
    };
    await f.registry.commitStage(f.stage); f.stage.discard(); const errors = [];
    for (const kind of ['pack', 'patch']) {
      const pack = structuredClone(f.pack); pack.name = 'Same displayed name';
      if (kind === 'patch') { pack.version = '2.0.0'; pack.patches[0].definition.name = 'Changed revision bytes'; }
      const stage = await make(pack);
      try { await f.registry.commitStage(stage); } catch (error) { errors.push(error.code); } finally { stage.discard(); }
    }
    const packs = await f.registry.listPacks();
    f.reader.dispose(); f.registry.close(); f.jobs.dispose(); f.admission.dispose();
    return { errors, packs: packs.entries.length, resources: f.budget.diagnostics().accountedBytes };
  });
  expect(result).toEqual({ errors: ['immutable-conflict', 'immutable-conflict'], packs: 1, resources: 0 });
});
