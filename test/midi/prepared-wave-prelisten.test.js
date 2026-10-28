import { expect } from 'chai';
import { createHash } from 'node:crypto';
import { createPreparedWavePrelisten } from '../../js/app/midi-ui/PreparedWavePrelisten.js';
import { createForegroundAuditionOwner } from '../../js/app/midi-ui/ForegroundAuditionOwner.js';
import { createProcgenRetirementScope } from '../../js/app/procgen/ProcgenRetirement.js';
import { createResourceBudget } from '../../js/app/resources/ResourceBudget.js';
import { prepareExportArtifact } from '../../js/app/export/ExportArtifact.js';
import { encodeOwnedAudioWav } from '../../js/app/midi-ui/OwnedAudioWav.js';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const refused = async promise => { try { await promise; } catch (error) { return error; } throw new Error('Expected refusal.'); };
const fixture = async () => {
  const budget = createResourceBudget(), foreground = createForegroundAuditionOwner(), calls = [], switches = { hold: null, disposalFailure: false }, route = { mode: 'rehearsal', state: 'ready', revision: 1 }, context = { state: 'running', sampleRate: 48000 }, source = { name: 'Body after the same excitation', kind: 'graft-take-readout', revision: '1', sourceRef: 'explicit-fixture' };
  const pcm = new Uint8Array(256 * 8), manifest = { schema: 'lemmings-causal-audio-render/v1', pcmHash: createHash('sha256').update(pcm).digest('hex'), frames: 256, channels: 2, sampleRate: 48000, sampleFormat: 'ieee-float32-le' }, bytes = encodeOwnedAudioWav(pcm, 256, 48000, manifest);
  const artifact = prepareExportArtifact({ bytes, immutableSourceRef: 'prepared-wave-fixture', formatVersion: manifest.schema, suggestedFilename: 'fixture.wav', budgetAdapter: budget }); await artifact.digest();
  const file = { artifact, manifest, label: source.name }, audio = {
    getAudioContext: () => context, getMonitorRouteState: () => route, getState: () => ({ enabled: true }), acquireAudition: options => foreground.acquire(options),
    createSession(id, options) {
      calls.push({ id, options }); const scope = createProcgenRetirementScope(), completion = deferred(); let cueScope;
      return { enable: async () => true,
        async preparePcmCue(input) {
          calls.push(input); if (switches.hold) { switches.hold.entered.resolve(); await switches.hold.release.promise; }
          cueScope = createProcgenRetirementScope();
          return { play: options => { switches.playedLevel = options.level01; return { status: 'accepted', targetTime: 0.04, acousticReceipt: false }; }, completion: completion.promise,
            dispose() { const receipt = cueScope.getReceipt() || cueScope.retire([{ name: 'synthetic-pcm-producer', run: () => { if (switches.disposalFailure) throw new Error('Synthetic unresolved native disconnection.'); } }]); receipt.completion.then(completion.resolve); return receipt; } };
        }, dispose: () => scope.getReceipt() || scope.retire()
      };
    }
  };
  const owner = createPreparedWavePrelisten({ audio, resourceBudget: budget });
  const dispose = async () => { const receipt = owner.dispose(); await receipt.completion; artifact.discard(); await artifact.digest(); const other = foreground.dispose(); await other.completion; return receipt; };
  return { owner, file, artifact, bytes, manifest, source, budget, foreground, calls, switches, route, context, dispose };
};

describe('prepared rendered-wave prelisten (synthetic lifetime fixtures; listening unqualified)', () => {
  it('passes explicit comparison attenuation into the owned cue and rejects invalid levels before acquiring it', async () => {
    const f = await fixture();
    try {
      for (const level01 of [NaN, -1, 1.01]) expect((await refused(f.owner.play({ file: f.file, source: f.source, level01 }))).message).to.include('attenuation');
      expect(f.foreground.state().active).to.equal(false); expect(f.artifact.metadata().activeLeases).to.equal(0);
      const result = await f.owner.play({ file: f.file, source: f.source, level01: 0.3 }); expect(f.switches.playedLevel).to.equal(0.3); expect(result.attenuation01).to.equal(0.3);
    } finally { await f.dispose(); }
    expect(f.budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('plays the exact retained file in the shared foreground cue and retains it until producer retirement', async () => {
    const f = await fixture();
    try {
      const result = await f.owner.play({ file: f.file, source: f.source }); expect(result.acousticReceipt).to.equal(false); expect(result.level).to.include('fixed-authored-gain'); expect(f.calls[0].options).to.deep.equal({ workloadClass: 'cue' });
      expect(f.calls[1].bytes).to.deep.equal(f.bytes); expect(f.calls[1].manifest).to.deep.equal(f.manifest); expect(f.calls[1].manifest).not.to.equal(f.manifest); expect(f.foreground.state().foreground.source).to.deep.equal(f.source); expect(f.artifact.metadata().activeLeases).to.equal(1);
      expect((await refused(f.owner.play({ file: f.file, source: f.source }))).message).to.include('Stop'); const receipt = f.owner.stop(); await receipt.completion; expect(receipt.outcome).to.equal('complete'); expect(f.artifact.metadata().activeLeases).to.equal(0); expect(f.foreground.state().active).to.equal(false);
    } finally { await f.dispose(); } expect(f.budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('settles an accepted preparation before releasing its file loan and overlap budget', async () => {
    const f = await fixture(), hold = f.switches.hold = { entered: deferred(), release: deferred() };
    try {
      const work = f.owner.play({ file: f.file, source: f.source }); await hold.entered.promise; const receipt = f.owner.stop(); expect(f.artifact.metadata().activeLeases).to.equal(1); expect(f.owner.state().active).to.equal(true); expect(f.budget.diagnostics().accountedBytes).to.be.greaterThan(f.bytes.byteLength);
      hold.release.resolve(); await refused(work); await receipt.completion; expect(receipt.outcome).to.equal('complete'); expect(f.artifact.metadata().activeLeases).to.equal(0);
    } finally { hold.release.resolve(); await f.dispose(); } expect(f.budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('rejects stale source/route results and preserves the prepared file for another explicit request', async () => {
    const f = await fixture(), hold = f.switches.hold = { entered: deferred(), release: deferred() };
    try {
      const work = f.owner.play({ file: f.file, source: f.source }); await hold.entered.promise; f.route.revision++; hold.release.resolve(); expect((await refused(work)).message).to.include('changed'); expect(f.artifact.metadata().activeLeases).to.equal(0); expect(f.artifact.metadata().retained).to.equal(true); expect(f.owner.state().playing).to.equal(false);
    } finally { hold.release.resolve(); await f.dispose(); } expect(f.budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('handles discard during playback through the same stop owner', async () => {
    const f = await fixture(); try { await f.owner.play({ file: f.file, source: f.source }); f.artifact.discard(); const receipt = f.owner.stop(); await receipt.completion; expect(receipt.outcome).to.equal('complete'); expect(f.artifact.metadata().activeLeases).to.equal(0); expect(f.foreground.state().active).to.equal(false); } finally { await f.dispose(); } expect(f.budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('retains source and budget when a producer cannot confirm retirement', async () => {
    const f = await fixture(); await f.owner.play({ file: f.file, source: f.source }); f.switches.disposalFailure = true;
    const receipt = f.owner.stop(); await receipt.completion; expect(receipt.outcome).to.equal('partial'); expect(f.artifact.metadata().activeLeases).to.equal(1); expect(f.owner.state().unresolvedRetirement).to.equal(1); expect(f.budget.diagnostics().accountedBytes).to.be.greaterThan(f.bytes.byteLength); expect((await refused(f.owner.play({ file: f.file, source: f.source }))).message).to.include('Stop'); await f.dispose();
  });
  it('refuses missing cue routes and overlong files before borrowing or creating a cue session', async () => {
    const f = await fixture(); try {
      f.route.mode = 'muted'; expect((await refused(f.owner.play({ file: f.file, source: f.source }))).message).to.include('explicit PRELISTEN'); f.route.mode = 'rehearsal';
      expect((await refused(f.owner.play({ file: { ...f.file, manifest: { ...f.manifest, frames: 48000 * 17 } }, source: f.source }))).message).to.include('sixteen seconds'); expect(f.calls).to.have.length(0); expect(f.artifact.metadata().activeLeases).to.equal(0);
    } finally { await f.dispose(); } expect(f.budget.diagnostics().accountedBytes).to.equal(0);
  });
});
