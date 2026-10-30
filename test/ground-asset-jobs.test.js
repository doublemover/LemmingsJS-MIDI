import { expect } from 'chai';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { BinaryReader } from '../js/data/BinaryReader.js';
import { FileContainer } from '../js/data/FileContainer.js';
import { GroundReader } from '../js/level/GroundReader.js';
import { DEFAULT_STEEL_SPRITES } from '../js/steelSpritesData.js';
import { GROUND_DECODE_VERSION, hydrateGroundAssets } from '../js/app/resources/GroundAssetDecode.js';
import { acquireSharedGroundAssets } from '../js/app/resources/GroundAssetRegistry.js';
import { runBackgroundJobKernel } from '../js/app/resources/BackgroundJobKernels.js';
import { createBackgroundJobService } from '../js/app/resources/BackgroundJobService.js';
import { createBackgroundWorkerAdmission } from '../js/app/resources/BackgroundWorkerAdmission.js';
import { createSharedContentJobs } from '../js/app/resources/SharedContentJobs.js';
import { createBackgroundJobWorkerEndpoint } from '../js/app/resources/BackgroundJobWorkerEndpoint.js';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const rejects = async (operation, code) => { let error; try { await operation; } catch (failure) { error = failure; } expect(error?.code).to.equal(code); };
describe('shared verified terrain decode jobs', () => {
  let ground, vgagr, steelIds;
  before(async () => {
    [ground, vgagr] = await Promise.all(['GROUND0O.DAT', 'VGAGR0.DAT'].map(filename => fs.readFile(new URL('../lemmings/' + filename, import.meta.url))));
    steelIds = DEFAULT_STEEL_SPRITES.lemmings['GROUND0O.DAT'] || [];
  });
  const input = () => ({ version: GROUND_DECODE_VERSION, ground: { bytes: new Uint8Array(ground), root: 'lemmings', filename: 'GROUND0O.DAT', sha256: sha256(ground) },
    vgagr: { bytes: new Uint8Array(vgagr), sha256: sha256(vgagr) }, steelIds });
  const limits = { estimatedPeakBytes: 64 * 1048576, maxBytes: 16 * 1048576, yieldControl: async () => {} };
  it('matches the existing decoder and hydrates immutable metadata once per shared result', async () => {
    const result = await runBackgroundJobKernel('asset-decode', input(), limits), assets = hydrateGroundAssets(result.value);
    const source = new BinaryReader(ground, 0, undefined, 'GROUND0O.DAT', 'lemmings'), graphics = new BinaryReader(vgagr), container = new FileContainer(graphics);
    const terrain = container.getPart(0), objects = container.getPart(1);
    try {
      const expected = new GroundReader(source, terrain, objects, { steelSprites: DEFAULT_STEEL_SPRITES });
      expect(assets.terrainImages.map(image => image.frames)).to.deep.equal(expected.getTerrainImages().map(image => image.frames));
      expect(assets.gadgetImages.map(image => image.frames)).to.deep.equal(expected.getObjectImages().map(image => image.frames));
      expect(assets.terrainImages.map(image => !!image.isSteel)).to.deep.equal(expected.getTerrainImages().map(image => !!image.isSteel));
      expect(assets.terrainImages[0].palette.getColor(1)).to.equal(expected.getTerrainImages()[0].palette.getColor(1));
      expect(hydrateGroundAssets(result.value)).to.equal(assets); expect(Object.isFrozen(assets.terrainImages[0])).to.equal(true);
      expect(result.retainedBytes).to.be.at.least(assets.decodedBytes);
    } finally { terrain.release(); objects.release(); container.dispose(); source.release(); graphics.release(); }
  });
  it('rejects changed source bytes and decoded capacity before creating image buffers', async () => {
    const changed = input(); changed.ground.bytes[0] ^= 1;
    await rejects(runBackgroundJobKernel('asset-decode', changed, limits), 'content-mismatch');
    const excessive = input(); excessive.ground.bytes[3] = 64; excessive.ground.bytes[4] = 255; excessive.ground.bytes[5] = 255;
    excessive.ground.sha256 = sha256(excessive.ground.bytes);
    await rejects(runBackgroundJobKernel('asset-decode', excessive, { ...limits, maxDecodedBytes: 128 * 1024 }), 'decode-capacity');
    const malformed = input(); malformed.vgagr.bytes[8] = 0; malformed.vgagr.bytes[9] = 1; malformed.vgagr.sha256 = sha256(malformed.vgagr.bytes);
    await rejects(runBackgroundJobKernel('asset-decode', malformed, limits), 'invalid-data');
  });
  it('shares one actual decode across two source owners and retains the result until both release it', async () => {
    let computations = 0, terminated = 0, finish;
    class Worker {
      constructor() { this.endpoint = createBackgroundJobWorkerEndpoint({ postMessage: data => queueMicrotask(() => this.onmessage({ data })), close() {}, kernel: (kind, input, limits) => {
        computations++; return new Promise(resolve => { finish = async () => resolve(await runBackgroundJobKernel(kind, input, { ...limits, yieldControl: async () => {} })); });
      } }); }
      postMessage(message) { void this.endpoint.receive(structuredClone(message)); }
      terminate() { terminated++; }
    }
    const admission = createBackgroundWorkerAdmission(), jobs = createBackgroundJobService({ admission, Worker }), contentJobs = createSharedContentJobs({ jobs });
    const sources = () => ({ ground: { reader: new BinaryReader(ground), source: { root: 'lemmings', filename: 'GROUND0O.DAT', sha256: sha256(ground) } },
      vgagr: { reader: new BinaryReader(vgagr), source: { root: 'lemmings', filename: 'VGAGR0.DAT', sha256: sha256(vgagr) } } });
    const first = sources(), second = sources(), canceled = new AbortController();
    const a = acquireSharedGroundAssets({ ...first, steelIds, contentJobs, signal: canceled.signal }).catch(error => error);
    const b = acquireSharedGroundAssets({ ...second, steelIds, contentJobs });
    for (let turn = 0; turn < 100 && contentJobs.diagnostics().consumers < 2; turn++) await new Promise(resolve => setTimeout(resolve, 0));
    expect(contentJobs.diagnostics().consumers).to.equal(2); canceled.abort(); expect(await a).to.be.instanceOf(Error);
    first.ground.reader.release(); first.vgagr.reader.release();
    while (!finish) await new Promise(resolve => setTimeout(resolve, 0)); await finish(); const kept = await b;
    try {
      expect(kept.value.terrainImages).to.have.length(64); expect(computations).to.equal(1); expect(terminated).to.equal(1);
      expect(admission.diagnostics().retainedResults).to.equal(1); expect(admission.diagnostics().memory.accountedBytes).to.be.greaterThan(0);
    } finally { kept.release(); second.ground.reader.release(); second.vgagr.reader.release(); contentJobs.dispose(); jobs.dispose(); admission.dispose(); }
    expect(admission.diagnostics().memory.accountedBytes).to.equal(0);
  });
});
