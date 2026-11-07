import { expect } from 'chai';
import { createProcgenTransport } from '../js/app/procgen/workstation/ProcgenTransport.js';
import { createProcgenTimingDriver } from '../js/app/procgen/workstation/ProcgenTimingDriver.js';
import { runInNewContext } from 'node:vm';

function fixture(options = {}) {
  let time = 0, callback = null;
  const beats = [], speeds = [], flushes = [], stops = [];
  const output = { messages: [], clears: 0, send(data, timestamp) { this.messages.push({ data, timestamp }); }, clear() { this.clears++; } };
  const driver = { start(fn) { callback = fn; }, stop() { callback = null; }, dispose() { this.disposed = true; } };
  const transport = createProcgenTransport({ now: () => time, driver, onBeat: event => beats.push(event),
    onSpeed: value => speeds.push(value), onFlush: reason => flushes.push(reason), onStop: reason => stops.push(reason), clockOutput: output, ...options });
  return { transport, output, beats, speeds, flushes, stops, driver,
    wake(at) { time = at; callback?.(); }, time(at) { time = at; }, advance(to) { while (time < to) { time = Math.min(to, time + 10); callback?.(); } } };
}

describe('ProcGen workstation independent transport', () => {
  it('retains a nominal step rate while pause or external-clock waiting keeps effective speed zero', () => {
    const f = fixture({ linked: true, speedMode: 'bpm', bpm: 180 });
    expect(f.transport.getState()).to.include({ nominalSpeed: 1.5, effectiveSpeed: 0 }); f.transport.play();
    expect(f.transport.getState()).to.include({ nominalSpeed: 1.5, effectiveSpeed: 1.5 }); f.transport.pause();
    expect(f.transport.getState()).to.include({ nominalSpeed: 1.5, effectiveSpeed: 0 }); f.transport.configure({ clockSource: 'external' }); f.transport.play();
    expect(f.transport.getState()).to.include({ nominalSpeed: 1.5, effectiveSpeed: 0 }); f.transport.dispose();
  });
  it('retires the timing driver after a flushing callback fails', () => {
    const f = fixture({ onFlush() { throw new Error('flush refused'); } });
    const receipt = f.transport.dispose();
    expect(f.driver.disposed).to.equal(true);
    expect(f.transport.dispose()).to.equal(receipt);
    expect(receipt.resources.find(resource => resource.name === 'transport-halt')).to.include({ status: 'failed', error: 'flush refused' });
  });
  it('timestamps a phase-stable 24 PPQN clock separately from physical game speed', () => {
    const f = fixture(); f.transport.play(); f.advance(500);
    const clocks = f.output.messages.filter(event => event.data[0] === 0xf8);
    expect(f.output.messages[0].data).to.deep.equal([0xfa]);
    expect(clocks.slice(0, 25).map(event => event.timestamp)).to.have.length(25);
    expect(clocks[24].timestamp).to.equal(500);
    expect(clocks[1].timestamp).to.be.closeTo(500 / 24, 1e-8);
    expect(f.transport.getState().beat).to.equal(1);
    f.transport.configure({ linked: false, gameSpeed: 4 });
    expect(f.transport.getState()).to.include({ bpm: 120, effectiveSpeed: 4 });
    f.transport.dispose();
  });

  it('keeps fractional musical phase through tempo edits and linked speed edits', () => {
    const f = fixture(); f.transport.play(); f.advance(125);
    f.transport.configure({ bpm: 240 });
    expect(f.transport.getState()).to.include({ beat: 0.25, effectiveSpeed: 2 });
    expect(f.flushes).to.include('tempo');
    f.advance(250);
    expect(f.transport.getState().beat).to.be.closeTo(0.75, 1e-9);
    f.transport.configure({ gameSpeed: 0.5 });
    expect(f.transport.getState()).to.include({ bpm: 60, effectiveSpeed: 0.5 });
    f.transport.dispose();
  });

  it('supports explicit game-speed mode, unlinking, and speeds above eight', () => {
    const f = fixture({ speedMode: 'game', baseBpm: 90, gameSpeed: 12 }); f.transport.play();
    expect(f.transport.getState()).to.include({ bpm: 1080, baseBpm: 90, gameSpeed: 12, speedMode: 'game', effectiveSpeed: 12, timestamp: 0 });
    f.transport.configure({ linked: false });
    expect(f.transport.getState()).to.include({ bpm: 90, effectiveSpeed: 12 });
    const state = f.transport.snapshot(); f.transport.restore(state);
    expect(f.transport.snapshot()).to.include({ speedMode: 'game', gameSpeed: 12, baseBpm: 90, linked: false });
    f.transport.dispose();
  });

  it('preserves extreme game speeds but stops explicitly before an unbounded clock burst', () => {
    const f = fixture({ speedMode: 'game', gameSpeed: 1e10 }); f.transport.play();
    expect(f.transport.getState()).to.include({ gameSpeed: 1e10, playing: false, reason: 'clock-overload' });
    expect(f.beats).to.have.length(0); f.transport.dispose();
  });

  it('clears future output and emits stop, song position, continue in order', () => {
    const f = fixture(); f.transport.play(); f.advance(100); f.transport.pause();
    expect(f.output.messages.at(-1).data).to.deep.equal([0xfc]);
    f.transport.seek(33.25); f.transport.play();
    const at = f.output.messages.findIndex(event => event.data[0] === 0xfb);
    expect(f.output.messages[at - 1].data).to.deep.equal([0xf2, 5, 1]);
    expect(f.output.messages[at + 1].data).to.deep.equal([0xf8]);
    expect(f.output.clears).to.be.greaterThan(0); f.transport.dispose();
  });

  it('stops after suspension without emitting a catch-up burst and needs explicit play', () => {
    const f = fixture(); f.transport.play(); const count = f.beats.length;
    f.wake(2000);
    expect(f.beats).to.have.length(count);
    expect(f.transport.getState()).to.include({ playing: false, clockStatus: 'suspended' });
    expect(f.transport.getState().lastDiscontinuity).to.include({ source: 'host-wake-gap', timeDomain: 'performance-ms', gapMs: 2000, limitMs: 250 });
    expect(Object.isFrozen(f.transport.getState().lastDiscontinuity)).to.equal(true);
    f.wake(2010); expect(f.beats).to.have.length(count);
    f.transport.play(); expect(f.transport.getState()).to.include({ playing: true, lastDiscontinuity: null }); f.transport.dispose();
  });
  it('distinguishes a failed timing driver from an external message delivered beyond the wake limit', () => {
    const local = fixture(); local.transport.play(); const count = local.beats.length;
    local.transport.pump({ suspended: true, reason: 'worker-runtime-failure' });
    expect(local.transport.getState().lastDiscontinuity).to.include({ source: 'timing-driver-suspended', driverReason: 'worker-runtime-failure', gapMs: 0 }); expect(local.beats).to.have.length(count); local.transport.dispose();
    const external = fixture({ clockSource: 'external' }); external.transport.play(); external.time(300);
    expect(external.transport.receiveMidi([0xf8], 0)).to.equal(false); expect(external.transport.getState().lastDiscontinuity).to.include({ source: 'external-message-delay', gapMs: 300, messageDelayMs: 300, limitMs: 250 }); expect(external.beats).to.have.length(0); external.transport.dispose();
  });

  it('external clock locks tempo, consumes SPP, estimates jitter, and never echoes clock or transport', () => {
    const f = fixture({ clockSource: 'external' });
    f.transport.receiveMidi([0xfa], 0);
    expect(f.transport.getState().effectiveSpeed).to.equal(0);
    for (let i = 0; i <= 24; i++) {
      const timestamp = i * 500 / 24 + (i % 2 ? 1 : 0);
      f.advance(timestamp); f.transport.receiveMidi([0xf8], timestamp);
    }
    expect(f.beats[0].beat).to.equal(0);
    expect(f.transport.getState()).to.include({ beat: 1, clockStatus: 'locked' });
    expect(f.transport.getState().bpm).to.be.closeTo(120, 0.01);
    f.transport.configure({ bpm: 200, gameSpeed: 2 });
    expect(f.transport.getState().bpm).to.be.closeTo(120, 0.01);
    f.transport.receiveMidi([0xf2, 5, 1]);
    expect(f.transport.getState().beat).to.equal(33.25);
    f.transport.receiveMidi([0xfc]); expect(f.transport.getState().playing).to.equal(false);
    expect(f.output.messages).to.deep.equal([]); f.transport.dispose();
  });

  it('loses external clock cleanly and rejects pulses until explicit Continue or Start', () => {
    const f = fixture({ clockSource: 'external', clockLossMs: 100 });
    f.transport.receiveMidi([0xfa]); f.transport.receiveMidi([0xf8]); f.advance(110);
    expect(f.transport.getState()).to.include({ playing: false, clockStatus: 'clock-lost' });
    expect(f.transport.receiveMidi([0xf8], 110)).to.equal(false);
    f.transport.receiveMidi([0xfb], 110); f.transport.receiveMidi([0xf8], 110);
    expect(f.transport.getState()).to.include({ playing: true, beat: 1 / 24 }); f.transport.dispose();
  });

  it('resumes external pulses at the next clock position rather than replaying the last pulse', () => {
    const f = fixture({ clockSource: 'external' }); f.transport.play();
    f.transport.receiveMidi([0xf8], 0); f.advance(20); f.transport.receiveMidi([0xf8], 20);
    f.transport.receiveMidi([0xfc], 20); f.transport.receiveMidi([0xfb], 20);
    f.advance(40); f.transport.receiveMidi([0xf8], 40);
    expect(f.beats.map(event => event.beat)).to.deep.equal([0, 1 / 24, 2 / 24]);
    f.transport.receiveMidi([0xfa], 40); f.transport.receiveMidi([0xf8], 40);
    expect(f.beats.at(-1).beat).to.equal(0); f.transport.dispose();
  });

  it('preserves the next external pulse separately from the last observed beat in checkpoints', () => {
    const first = fixture({ clockSource: 'external' }); first.transport.play();
    first.transport.receiveMidi([0xf8], 0); first.advance(20); first.transport.receiveMidi([0xf8], 20);
    const saved = first.transport.snapshot(); first.transport.dispose();
    const second = fixture(); second.transport.restore(saved); second.transport.play(); second.advance(40); second.transport.receiveMidi([0xf8], 40);
    expect(second.beats[0].beat).to.equal(2 / 24); second.transport.dispose();
  });

  it('preserves incoming external musical tempo above internal UI tempo limits', () => {
    const f = fixture({ clockSource: 'external' }); f.transport.play();
    for (let pulse = 0; pulse <= 24; pulse++) { f.advance(pulse * 60000 / 1200 / 24); f.transport.receiveMidi([0xf8], pulse * 60000 / 1200 / 24); }
    expect(f.transport.getState().bpm).to.be.closeTo(1200, 1e-6);
    expect(f.transport.getState().beat).to.equal(1); f.transport.dispose();
  });

  it('rejects stale or non-monotonic external pulses', () => {
    const f = fixture({ clockSource: 'external' }); f.transport.play();
    expect(f.transport.receiveMidi([0xf8], 0)).to.equal(true);
    expect(f.transport.receiveMidi([0xf8], 0)).to.equal(false);
    f.time(400); expect(f.transport.receiveMidi([0xf8], 10)).to.equal(false);
    expect(f.transport.getState().playing).to.equal(false); f.transport.dispose();
  });

  it('replaces clock destinations only after clearing and stopping the old port', () => {
    const f = fixture(); f.transport.play();
    const next = { send() { throw new Error('should not auto restart'); }, clear() {} };
    f.transport.setClockOutput(next);
    expect(f.output.messages.at(-1).data).to.deep.equal([0xfc]);
    expect(f.output.clears).to.equal(1); expect(f.transport.getState().playing).to.equal(false);
    f.transport.dispose();
  });

  it('restores measured external tempo and the separate internal tempo preference', () => {
    const f = fixture({ clockSource: 'external', baseBpm: 90 }); f.transport.play();
    for (let pulse = 0; pulse < 6; pulse++) { f.wake(pulse * 25); f.transport.receiveMidi([0xf8], pulse * 25); }
    const saved = f.transport.snapshot(), restored = fixture(); restored.transport.restore(saved);
    expect(restored.transport.getState()).to.include({ bpm: 100, baseBpm: 90, playing: false, clockSource: 'external' });
    restored.transport.play(); restored.transport.receiveMidi([0xf8], 0);
    expect(restored.beats[0].bpm).to.equal(100);
    restored.transport.configure({ clockSource: 'internal' }); expect(restored.transport.getState().bpm).to.equal(90);
    f.transport.dispose(); restored.transport.dispose();
  });

  it('uses timely external pulses as wakeups while retaining the real suspension deadline', () => {
    const f = fixture({ clockSource: 'external' }); f.transport.play();
    for (let pulse = 0; pulse < 30; pulse++) { f.time(pulse * 20); f.transport.receiveMidi([0xf8], pulse * 20); }
    expect(f.transport.getState()).to.include({ playing: true, clockStatus: 'locked' });
    expect(f.beats).to.have.length(30);
    f.time(831); f.transport.receiveMidi([0xf8], 831);
    expect(f.transport.getState()).to.include({ playing: false, clockStatus: 'suspended' });
    expect(f.transport.getState().lastDiscontinuity).to.include({ source: 'host-wake-gap', gapMs: 251, messageDelayMs: 0, limitMs: 250 });
    expect(f.beats).to.have.length(30); f.transport.dispose();
  });

  it('restores paused, disposes timers and never starts after disposal', () => {
    const f = fixture(); f.transport.play(); f.advance(125);
    const saved = f.transport.snapshot(); expect(saved.playing).to.equal(false);
    f.transport.stop(); f.transport.restore(saved);
    expect(f.transport.getState()).to.include({ beat: 0.25, playing: false });
    f.transport.dispose(); f.transport.play(); expect(f.driver.disposed).to.equal(true);
    expect(f.transport.getState().playing).to.equal(false);
  });
});

describe('ProcGen background timing driver', () => {
  it('acknowledges a single worker wake, detects failure, and revokes its Blob URL', () => {
    const created = [], revoked = [], signals = [];
    class FakeWorker { constructor(url) { this.url = url; this.messages = []; created.push(this); } postMessage(value) { this.messages.push(value); } terminate() { this.terminated = true; } }
    const host = { Worker: FakeWorker, Blob: class {}, performance: { now: () => 30 },
      URL: { createObjectURL: () => 'blob:clock', revokeObjectURL: value => revoked.push(value) } };
    const driver = createProcgenTimingDriver({ host }); driver.start(value => signals.push(value));
    const start = created[0].messages[0];
    created[0].onmessage({ data: { epoch: start.epoch, sequence: 1, sourceTimeMs: 0 } });
    created[0].onmessage({ data: { epoch: start.epoch, sequence: 1, sourceTimeMs: 0 } });
    expect(start).to.include({ kind: 'start', intervalMs: 10 });
    expect(created[0].messages[1]).to.deep.equal({ kind: 'ack', epoch: start.epoch, sequence: 1 });
    expect(driver.diagnostics()).to.include({ mode: 'worker', wakes: 1, lateWakes: 1 });
    created[0].onerror();
    expect(created[0].terminated).to.equal(true);
    expect(signals).to.deep.equal([{ epoch: start.epoch, sequence: 1, sourceTimeMs: 0 },
      { suspended: true, reason: 'worker-runtime-failure', epoch: start.epoch }]);
    expect(revoked).to.deep.equal(['blob:clock']);
  });

  it('falls back to interval wakeups and clears them on stop', () => {
    const cleared = []; let wake;
    const driver = createProcgenTimingDriver({ host: { setInterval(fn) { wake = fn; return 7; }, clearInterval(id) { cleared.push(id); } } });
    let calls = 0; driver.start(() => calls++); wake(); driver.stop();
    expect(calls).to.equal(1); expect(cleared).to.deep.equal([7]);
  });
  it('rejects retired worker messages and errors after rapid restart', () => {
    const workers = [], signals = [];
    class FakeWorker { constructor() { workers.push(this); this.messages = []; } postMessage(value) { this.messages.push(value); } terminate() { this.terminated = true; } }
    const host = { Worker: FakeWorker, Blob: class {}, performance: { now: () => 200 },
      URL: { createObjectURL: () => 'blob:clock', revokeObjectURL() {} } };
    const driver = createProcgenTimingDriver({ host });
    driver.start(value => signals.push(['old', value]));
    const oldEpoch = workers[0].messages[0].epoch;
    driver.start(value => signals.push(['new', value]));
    const newEpoch = workers[1].messages[0].epoch;
    workers[0].onmessage({ data: { epoch: oldEpoch, sequence: 1, sourceTimeMs: 100 } });
    workers[0].onerror();
    workers[1].onmessage({ data: { epoch: newEpoch, sequence: 1, sourceTimeMs: 190 } });
    expect(signals).to.deep.equal([['new', { epoch: newEpoch, sequence: 1, sourceTimeMs: 190 }]]);
    expect(driver.diagnostics()).to.include({ mode: 'worker', wakes: 1 });
    driver.stop(); workers[1].onmessage({ data: { epoch: newEpoch, sequence: 2, sourceTimeMs: 200 } });
    expect(signals).to.have.length(1);
  });
  it('keeps only one unacknowledged wake during a long main-thread stall', () => {
    let blob, workerTick, worker;
    const queued = [], delivered = [];
    class FakeBlob { constructor(parts) { blob = parts.join(''); } }
    class FakeWorker {
      constructor() {
        worker = this;
        const workerHost = { performance: { now: () => 100 }, postMessage: value => queued.push(value),
          setInterval: callback => { workerTick = callback; return 1; }, clearInterval() {} };
        runInNewContext(blob, workerHost);
        this.workerHost = workerHost;
      }
      postMessage(value) { this.workerHost.onmessage({ data: value }); }
      terminate() {}
    }
    const host = { Worker: FakeWorker, Blob: FakeBlob, performance: { now: () => 150 },
      URL: { createObjectURL: () => 'blob:clock', revokeObjectURL() {} } };
    const driver = createProcgenTimingDriver({ host }); driver.start(value => delivered.push(value.sequence));
    for (let i = 0; i < 100; i++) workerTick();
    expect(queued).to.have.length(1);
    worker.onmessage({ data: queued.shift() });
    workerTick(); expect(queued).to.have.length(1);
    worker.onmessage({ data: queued.shift() });
    expect(delivered).to.deep.equal([1, 2]);
    driver.dispose();
  });
});
