import { expect } from 'chai';
import { readFile } from 'node:fs/promises';
import { createMidiProject } from '../../js/midi/project/MidiProject.js';
import { createMidiLocalInstrumentMigration } from '../../js/app/midi-ui/MidiLocalInstrumentMigration.js';
import { compileSoundContent } from '../../js/midi/content/SoundContentCompiler.js';
import { resolveSoundContentReference } from '../../js/midi/content/SoundContentReference.js';
import { createResourceBudget } from '../../js/app/resources/ResourceBudget.js';
import { nativeSoundCandidates } from '../helpers/native-sound-candidates.js';

const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const refuse = async work => { try { await work; } catch (error) { return error; } throw new Error('Expected a refused conversion.'); };
const project = () => createMidiProject({ tracks: [null, 1, 35, 81, 113, 25, 90, 10].map((program, index) => ({ id: 'default-' + index, channel: index + 1, program })),
  sources: [{ id: 'sfx-1', kind: 'sfx', key: '1', trackId: 'default-0', mapping: { note: 60 } }, { id: 'sfx-2', kind: 'sfx', key: '2', trackId: 'default-7', mapping: { note: 60, percussion: true } }] });

describe('bounded multi-instrument native default conversion (#1286)', function() {
  this.timeout(30000); let descriptors;
  before(async () => { ({ descriptors } = await nativeSoundCandidates()); });
  const fixture = () => {
    const budget = createResourceBudget(), control = { compiles: 0, failCompileAt: null, unknownReleaseAt: null, activeResults: 0, peakResults: 0, releases: 0, holdRead: null };
    const jobs = { async compute(request) {
      const input = await request.prepareInput(); request.signal.throwIfAborted(); let value;
      const compilation = request.kind === 'compile-sound-content' ? ++control.compiles : null;
      if (compilation === control.failCompileAt && compilation !== null) throw new Error('controlled compile failure');
      if (request.kind === 'parse-json') value = JSON.parse(input);
      else { const result = await compileSoundContent(input, { targets: descriptors.map(descriptor => ({ descriptor })) }); value = { pack: result.prepared.pack, contentHash: result.prepared.contentHash, sourceHash: result.sourceHash }; }
      request.signal.throwIfAborted(); let phase = 'retained-result'; control.activeResults++; control.peakResults = Math.max(control.peakResults, control.activeResults);
      return { get value() { if (phase === 'released') throw new Error('A released worker result was read.'); return value; }, receipt: { inputBytes: 128 * 1024 },
        release() { if (phase === 'released' || compilation === control.unknownReleaseAt && compilation !== null) return; phase = 'released'; value = null; control.activeResults--; control.releases++; },
        retirementState: () => ({ phase }) };
    } };
    const migration = createMidiLocalInstrumentMigration({ resourceBudget: budget, jobs, getCatalog: async () => ({ descriptors }), fetch: async url => {
      const held = control.holdRead; if (held) { control.holdRead = null; held.entered.resolve(); await held.release.promise; }
      return new globalThis.Response(await readFile(url), { headers: { 'Content-Type': 'application/json' } });
    } });
    return { migration, budget, control };
  };
  it('converts eight distinct aliases atomically and keeps references valid after worker readers retire', async () => {
    const f = fixture(), source = project(), before = JSON.stringify(source);
    try {
      const result = await f.migration.prepare(source);
      expect(result.changed).to.equal(true); expect(new Set(result.plan.entries.map(row => row.patchId)).size).to.equal(8);
      expect(result.project.tracks.every(track => track.instrumentRef)).to.equal(true); expect(result.project.tracks.map(track => track.program)).to.deep.equal(source.tracks.map(track => track.program));
      expect(JSON.stringify(source)).to.equal(before); expect(f.control.activeResults).to.equal(0); expect(f.control.peakResults).to.equal(2);
      for (const track of result.project.tracks) expect((await resolveSoundContentReference(track.instrumentRef, { engineDescriptors: descriptors, availableHashes: [] })).status).to.equal('ready');
      expect(f.budget.diagnostics().accountedBytes).to.equal(0);
    } finally { await f.migration.dispose().completion; }
  });
  it('preserves the old project after a later compile failure and admits a clean retry', async () => {
    const f = fixture(), source = project(), before = JSON.stringify(source); f.control.failCompileAt = 3;
    try {
      expect((await refuse(f.migration.prepare(source))).message).to.include('controlled compile failure');
      expect(JSON.stringify(source)).to.equal(before); expect(f.control.activeResults).to.equal(0); expect(f.budget.diagnostics().accountedBytes).to.equal(0);
      f.control.failCompileAt = null; expect((await f.migration.prepare(source)).project.tracks.every(track => track.instrumentRef)).to.equal(true);
      expect(f.control.activeResults).to.equal(0); expect(f.budget.diagnostics().accountedBytes).to.equal(0);
    } finally { await f.migration.dispose().completion; }
  });
  for (const mode of ['cancel', 'stale']) it('fences a held source read after ' + mode + ' and preserves the original project', async () => {
    const f = fixture(), source = project(), before = JSON.stringify(source), held = { entered: deferred(), release: deferred() }, abort = new AbortController(); let current = true;
    f.control.holdRead = held; const preparing = f.migration.prepare(source, { signal: abort.signal, isCurrent: () => current }); preparing.catch(() => {});
    await held.entered.promise; if (mode === 'cancel') abort.abort(new Error('conversion canceled')); else current = false; held.release.resolve();
    try {
      await refuse(preparing); expect(JSON.stringify(source)).to.equal(before); expect(f.control.activeResults).to.equal(0); expect(f.budget.diagnostics().accountedBytes).to.equal(0);
      expect((await f.migration.prepare(source)).changed).to.equal(true); expect(f.budget.diagnostics().accountedBytes).to.equal(0);
    } finally { await f.migration.dispose().completion; }
  });
  it('retains unknown worker ownership and refuses another conversion without losing the project', async () => {
    const f = fixture(), source = project(), before = JSON.stringify(source); f.control.unknownReleaseAt = 3;
    const failed = await refuse(f.migration.prepare(source)); expect(failed.retirement.outcome).to.equal('partial');
    expect(JSON.stringify(source)).to.equal(before); expect(f.budget.diagnostics().accountedBytes).to.be.greaterThan(0);
    const attempts = f.control.compiles; await refuse(f.migration.prepare(source)); expect(f.control.compiles).to.equal(attempts);
    const receipt = f.migration.dispose(); await receipt.completion; expect(receipt.outcome).to.equal('partial'); expect(f.budget.diagnostics().accountedBytes).to.be.greaterThan(0);
  });
});
