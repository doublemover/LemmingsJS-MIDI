import { expect } from 'chai';
import fs from 'node:fs/promises';
import { inspectWasmHeapImageState, prepareStretchImageModuleBytes, STRETCH_STACK_EXPORT } from '../../js/app/resources/StretchCoreImageAbi.js';
import { OWNED_STRETCH_CORE } from '../../js/midi/content/OwnedStretchCoreIdentity.js';

const unsigned = value => { const bytes = []; do { const low = value % 128; value = Math.floor(value / 128); bytes.push(low | (value ? 128 : 0)); } while (value); return bytes; };
const section = (id, payload) => [id, ...unsigned(payload.length), ...payload];
const binary = ({ instructions = [11], globals = [1, 127, 1, 65, 16, 11], extra = [], memories = [1, 1, 1, 1] } = {}) => {
  const body = [0, ...instructions]; return new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, ...section(1, [1, 96, 0, 0]), ...section(3, [1, 0]), ...section(4, [1, 112, 1, 1, 1]), ...section(5, memories), ...section(6, globals), ...section(7, [0]), ...extra, ...section(10, [1, ...unsigned(body.length), ...body])]);
};

describe('stretch heap-image binary ABI (runtime transfer qualification deferred)', () => {
  it('walks instruction immediates rather than mistaking an encoded constant for a table write', () => {
    const bytes = binary({ instructions: [65, 38, 26, 11] }), original = bytes.slice(), value = inspectWasmHeapImageState(bytes);
    expect(value.heapImageEligible).to.equal(true); expect(value.globals).to.deep.equal([{ index: 0, type: 127, mutable: true, initialValue: 16 }]); expect(value.codeFunctions).to.equal(1); expect(value.tableMutationInstructions).to.equal(0); expect(value.memoryGrowthInstructions).to.equal(0); expect(bytes).to.deep.equal(original); expect(value.evidence).to.include('no-compilation-or-execution');
  });
  it('refuses automatic start, mutable tables, internal memory growth and additional global state for image transport', () => {
    expect(inspectWasmHeapImageState(binary({ extra: section(8, [0]) })).heapImageEligible).to.equal(false);
    expect(inspectWasmHeapImageState(binary({ instructions: [65, 0, 65, 0, 37, 0, 38, 0, 11] })).tableMutationInstructions).to.equal(1);
    expect(inspectWasmHeapImageState(binary({ instructions: [65, 0, 64, 0, 26, 11] })).heapImageEligible).to.equal(false);
    expect(inspectWasmHeapImageState(binary({ globals: [2, 127, 1, 65, 16, 11, 127, 1, 65, 32, 11] })).heapImageEligible).to.equal(false);
    expect(inspectWasmHeapImageState(binary({ globals: [1, 127, 1, 65, 17, 11] })).heapImageEligible).to.equal(false);
  });
  it('fails closed on malformed sections, truncation, shared storage and unsupported reference/SIMD state', () => {
    const bytes = binary(); for (const cut of [0, 7, 12, bytes.length - 1]) expect(() => inspectWasmHeapImageState(bytes.slice(0, cut))).to.throw();
    expect(() => inspectWasmHeapImageState(binary({ instructions: [253, 0, 11] }))).to.throw('Unsupported'); expect(() => inspectWasmHeapImageState(binary({ memories: [1, 2, 1] }))).to.throw('Shared'); expect(() => inspectWasmHeapImageState(binary({ instructions: [65, 0, 11, 1] }))).to.throw('completed function');
    const duplicate = new Uint8Array([...bytes, ...section(6, [0])]); expect(() => inspectWasmHeapImageState(duplicate)).to.throw('duplicate');
  });
  it('does not admit an arbitrary structurally suitable module as the pinned stretch artifact', async () => {
    let error; try { await prepareStretchImageModuleBytes(binary()); } catch (caught) { error = caught; } expect(error.message).to.include('exact pinned');
  });
});

describe('exact pinned stretch export derivation (static module fixture; no DSP execution)', () => {
  let bytes;
  before(async function() { try { bytes = new Uint8Array(await fs.readFile(OWNED_STRETCH_CORE.cachePath)); } catch (error) { if (error.code === 'ENOENT') return this.skip(); throw error; } });
  it('retains every non-export section byte and exposes only the one quiescent stack global', async () => {
    const original = bytes.slice(), result = await prepareStretchImageModuleBytes(bytes), before = inspectWasmHeapImageState(bytes), after = inspectWasmHeapImageState(result.bytes);
    expect(result.bytes.length).to.equal(OWNED_STRETCH_CORE.imageModule.bytes); expect(result.metadata.derivedModuleHash).to.equal(OWNED_STRETCH_CORE.imageModule.sha256); expect(bytes).to.deep.equal(original); expect(result.metadata.expectedQuiescentStack).to.equal(72800); expect(after.exports.find(value => value.name === STRETCH_STACK_EXPORT)).to.deep.equal({ name: STRETCH_STACK_EXPORT, kind: 3, index: 0 });
    expect(after.sections.map(value => value.id)).to.deep.equal(before.sections.map(value => value.id));
    for (let index = 0; index < before.sections.length; index++) if (before.sections[index].id !== 7) expect(result.bytes.subarray(after.sections[index].payload, after.sections[index].end)).to.deep.equal(bytes.subarray(before.sections[index].payload, before.sections[index].end));
    expect(after.heapImageEligible).to.equal(true); expect(after.tableMutationInstructions).to.equal(0); expect(after.memoryGrowthInstructions).to.equal(0);
    const module = await WebAssembly.compile(result.bytes); expect(WebAssembly.Module.exports(module).find(value => value.name === STRETCH_STACK_EXPORT).kind).to.equal('global');
  });
  it('seals caller bytes before asynchronous hashing and fences stale/canceled preparation', async () => {
    const caller = bytes.slice(), work = prepareStretchImageModuleBytes(caller); caller.fill(0); const result = await work; expect(result.metadata.derivedModuleHash).to.equal(OWNED_STRETCH_CORE.imageModule.sha256);
    let calls = 0, error; try { await prepareStretchImageModuleBytes(bytes, { current: () => ++calls < 2 }); } catch (caught) { error = caught; } expect(error.message).to.include('owner changed');
    const controller = new AbortController(); controller.abort(new Error('Canceled fixture')); error = null; try { await prepareStretchImageModuleBytes(bytes, { signal: controller.signal }); } catch (caught) { error = caught; } expect(error.message).to.include('Canceled fixture');
  });
});
