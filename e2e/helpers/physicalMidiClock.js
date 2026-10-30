import { expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import JZZ from 'jzz';
import installSmf from 'jzz-midi-smf';
import { parseSmf } from '../../test/support/smf.js';
import { revealWorkstationControl } from './workstationChrome.js';
installSmf(JZZ);

export async function armActualPhysicalClock(page, { external = false, speed = 3, action = false, generationFixture = false } = {}) {
  await page.goto('/dist/browser/procgen.html?e2e=1&workstation=1&seed=42&lanes=1');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain, null, { timeout: 90000 });
  return page.evaluate(async ({ external, speed, action, generationFixture }) => {
    const studio = window.__PROCGEN_STUDIO__, api = window.__PROCGEN_LANES__; studio.transport.pause(); api.pause();
    if (external) { await studio.handlers.connect(); studio.handlers.input('pw-input-1'); }
    studio.handlers.transport({ bpm: 120, baseBpm: 120, speedMode: 'game', linked: false, gameSpeed: speed, clockSource: external ? 'external' : 'internal' });
    if (generationFixture) {
      const world = api.world; world.assists = false;
      Object.assign(world.stall.settings, { secondsWithoutProgress: 3, baseSpawnAllowance: 1, maxSpawnAllowance: 1, transitSafetyFactor: 0, workGraceSeconds: 0, pendingWorkGraceSeconds: 0 });
      for (let x = 64; x < 72; x++) for (let y = 0; y < world.laneHeight; y++) world.setGroundAt(x, y);
      studio.play(); api.pause(); api.step(); studio.transport.pause(); api.pause();
    }
    studio.dispatch({ type: 'procgen/physicalGraph', graph: { version: 1, revision: studio.getProject().procgen.physicalGraph.revision + 1,
      instruments: [40, 42].map((gateX, index) => ({ id: 'clock-crossing-' + index, sourceKind: 'MotionCommitted', gateX, crossingDirection: 'positive', pitchCents: 6012.34567 + index * 700,
        velocity01: 0.8, role: 'crossing', route: 'local' })).concat(action ? [{ id: 'clock-held-walk', sourceKind: 'ActionEntered', pitchCents: 7200, velocity01: 0.6, role: 'held', route: 'local',
        actionVoicePolicy: { matchActions: ['walking'], maximumHoldTicks: 12, transitionPolicy: 'release' } }] : []) } });
    window.__physicalClockBatches = [];
    api.world.soundEvents.onBatch.on(batch => {
      if (window.__physicalClockBatches.length >= 4096) throw new Error('Clock fixture exceeded its bounded batch history.');
      window.__physicalClockBatches.push({ tick: batch.tick, generation: batch.generation, sourceTimeMs: batch.sourceTimeMs, tickDurationMs: batch.tickDurationMs,
        hostEventTimeMs: api.world.eventTimeMs, transportBeat: studio.transport.getState().beat, terminalGenerationTransition: batch.terminalGenerationTransition ?? null });
    });
    const armed = await studio.handlers.startCausalTake({ takeName: external ? 'Actual external clock MIDI matrix' : 'Actual physical clock MIDI matrix' });
    if (!armed) throw new Error('Clock matrix take admission failed.');
    return { takeId: armed.takeId, tick: api.world.tickIndex, generation: api.world.generation };
  }, { external, speed, action, generationFixture });
}

export async function finishActualPhysicalClock(page, takeId) {
  return page.evaluate(async takeId => {
    const studio = window.__PROCGEN_STUDIO__, api = window.__PROCGEN_LANES__; studio.transport.pause(); api.pause();
    const stopped = await studio.handlers.stopCausalTake(); if (!stopped?.complete) throw new Error('Actual clock take is incomplete.');
    const root = new URL('./', location.href), [{ createProcgenSessionStorage }, { createProcgenCausalJournal }] = await Promise.all([
      import(new URL('js/app/procgen/workstation/ProcgenSessionStorage.js', root)), import(new URL('js/app/procgen/workstation/ProcgenCausalJournal.js', root))]);
    let storage = createProcgenSessionStorage();
    try {
      const journal = createProcgenCausalJournal({ storage }), manifest = await journal.openTake(takeId), page = await journal.query({ takeId, limit: 4096 });
      if (page.nextSequence != null) throw new Error('Clock fixture source exceeded one bounded journal page.');
      const intents = page.records.filter(record => record.kind === 'musical-intents').flatMap(record => record.payload.intents);
      const inputs = page.records.filter(record => record.kind === 'input-observation').map(record => ({ sequence: record.sequence, tick: record.tick, payload: record.payload }));
      storage.close(); storage = createProcgenSessionStorage(); const reopened = await createProcgenCausalJournal({ storage }).openTake(takeId);
      if (manifest.canonicalHash !== reopened.canonicalHash) throw new Error('Reopened clock source changed.');
      await studio.handlers.selectCausalTake(takeId); studio.transport.configure({ bpm: 17 });
      return { takeId, stopped, canonicalHash: reopened.canonicalHash, clock: reopened.stopBoundaryState.timeline, boundary: reopened.boundaryState,
        intents, inputs, batches: window.__physicalClockBatches, tick: api.world.tickIndex, generation: api.world.generation, project: JSON.stringify(studio.getProject()) };
    } finally { storage.close(); }
  }, takeId);
}

export async function downloadActualPhysicalMidi(page, { epochOrdinal = null } = {}) {
  const button = page.getByRole('button', { name: 'Physical take MIDI1', exact: true, includeHidden: true }); await revealWorkstationControl(page, button);
  const downloading = page.waitForEvent('download'); await button.click();
  if (epochOrdinal != null) await page.locator('.studio-midi-export-routes').getByRole('button', { name: new RegExp('^Prepare clock epoch ' + epochOrdinal + '(?:[^0-9]|$)') }).click();
  const download = await downloading;
  const bytes = await readFile(await download.path()), parsed = parseSmf(bytes);
  const manifest = JSON.parse(new TextDecoder().decode(new Uint8Array(parsed.find(row => row.type === 1).data)));
  return { bytes, parsed, manifest, filename: download.suggestedFilename() };
}

export function assertCapturedClockMidi(actual, file) {
  const { timing, epochSelection } = file.manifest, epoch = actual.clock.timeline.epochs.find(entry => entry.epoch === epochSelection.epoch), ppq = timing.ppq;
  const beatAt = time => {
    const segment = epoch.segments.findLast(segment => segment.simTickOrigin <= time.simTick);
    return segment.scoreBeatOrigin + (time.simTick - segment.simTickOrigin + (time.subTick ?? 0)) * segment.tickDurationMs * segment.tempoBpm / 60000;
  };
  const origin = beatAt(timing.origin), afterOrigin = time => time.simTick > timing.origin.simTick || time.simTick === timing.origin.simTick && (time.subTick ?? 0) >= timing.origin.subTick;
  const beforeEnd = time => time.simTick < timing.end.simTick || time.simTick === timing.end.simTick && (time.subTick ?? 0) <= timing.end.subTick;
  const selected = actual.intents.filter(intent => intent.scoreTime.epoch === epoch.epoch && afterOrigin(intent.scoreTime) && beforeEnd(intent.scoreTime));
  const sourceNotes = selected.filter(intent => intent.kind === 'begin' || intent.kind === 'end');
  const notes = file.parsed.filter(row => [0x80, 0x90].includes(row.status & 0xf0));
  expect(notes.length).toBeGreaterThan(0); expect(notes.map(row => row.tick)).toEqual(sourceNotes.map(intent => Math.round((beatAt(intent.scoreTime) - origin) * ppq)));
  expect(notes.map(row => row.status & 0xf0)).toEqual(sourceNotes.map(intent => intent.kind === 'begin' ? 0x90 : 0x80));
  const independent = new JZZ.MIDI.SMF(file.bytes), independentNotes = Array.from(independent[0]).filter(row => [0x80, 0x90].includes(row[0] & 0xf0));
  expect(independentNotes.map(row => ({ tick: row.tt, bytes: Array.from(row) }))).toEqual(notes.map(row => ({ tick: row.tick, bytes: [row.status, ...row.data] })));
  const tempos = file.parsed.filter(row => row.type === 0x51).map(row => ({ tick: row.tick, value: row.data[0] * 65536 + row.data[1] * 256 + row.data[2] }));
  const initial = epoch.segments.findLast(segment => segment.simTickOrigin <= timing.origin.simTick), expectedTempos = [{ tick: 0, value: Math.round(60000000 / initial.tempoBpm) }];
  let previous = initial.tempoBpm;
  for (const segment of epoch.segments) {
    if (segment.scoreBeatOrigin <= origin || segment.scoreBeatOrigin > beatAt(timing.end) || segment.tempoBpm === previous) continue;
    expectedTempos.push({ tick: Math.round((segment.scoreBeatOrigin - origin) * ppq), value: Math.round(60000000 / segment.tempoBpm) }); previous = segment.tempoBpm;
  }
  expect(tempos).toEqual(expectedTempos); expect(file.parsed.at(-1).tick).toBe(Math.round((beatAt(timing.end) - origin) * ppq));
  const sourceMsAt = time => {
    let milliseconds = 0;
    for (let index = 0; index < epoch.segments.length; index++) {
      const segment = epoch.segments[index]; if (segment.simTickOrigin > time.simTick) break;
      const through = Math.min(time.simTick, epoch.segments[index + 1]?.simTickOrigin ?? time.simTick);
      milliseconds += (through - segment.simTickOrigin) * segment.tickDurationMs;
      if (through === time.simTick && (epoch.segments[index + 1]?.simTickOrigin ?? Infinity) > time.simTick) { milliseconds += (time.subTick ?? 0) * segment.tickDurationMs; break; }
    }
    return milliseconds;
  };
  const fileMsAt = tick => {
    let milliseconds = 0;
    for (let index = 0; index < tempos.length; index++) {
      const tempo = tempos[index]; if (tempo.tick > tick) break;
      milliseconds += (Math.min(tick, tempos[index + 1]?.tick ?? tick) - tempo.tick) * tempo.value / (1000 * ppq);
    }
    return milliseconds;
  };
  const measuredErrors = sourceNotes.map((intent, index) => Math.abs(fileMsAt(notes[index].tick) - (sourceMsAt(intent.scoreTime) - sourceMsAt(timing.origin))));
  measuredErrors.push(Math.abs(fileMsAt(timing.endTick) - (sourceMsAt(timing.end) - sourceMsAt(timing.origin))));
  const maximumMeasuredErrorMs = Math.max(...measuredErrors);
  expect(timing.liveLatenessApplied).toBe(false); expect(timing.ordering).toContain('canonical-intent-order');
  expect(timing.quantization.maximumTimingErrorMs + 1e-7).toBeGreaterThanOrEqual(maximumMeasuredErrorMs); expect(Number.isFinite(timing.quantization.maximumTimingErrorMs)).toBe(true);
  expect(timing.quantization.maximumBeatError).toBeLessThanOrEqual(0.5 / ppq + 1e-10);
  expect(file.manifest.sourceCanonicalHash).toBe(actual.canonicalHash);
  return { independentReader: 'jzz-midi-smf@1.9.9/jzz@1.9.6', sourceNotes: sourceNotes.length, ticks: notes.map(row => row.tick), tempos, maximumMeasuredErrorMs, manifest: file.manifest };
}
