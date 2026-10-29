import { expect } from 'chai';
import { createProcgenMidiPorts } from '../js/app/procgen/workstation/ProcgenMidiPorts.js';
import { createResourceBudget } from '../js/app/resources/ResourceBudget.js';

const publicRows = rows => rows.map(row => ({ timestamp: row.timestamp, data: row.data, outputId: row.outputId ?? null, intentRenderId: row.intentRenderId ?? null }));

describe('recording intent ownership against full-history reference', () => {
  for (const initialSeed of [1, 7, 19, 41, 97, 281, 1024, 65537]) it('retains complete voice/time/route history through generated flush and Panic seed ' + initialSeed, async () => {
    const budget = createResourceBudget(); let now = 1000, seed = initialSeed, nextId = 0;
    const ports = createProcgenMidiPorts({ now: () => now, resourceBudget: budget, maxRecordedEvents: 10000 }), records = [], pending = [];
    const random = maximum => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed >>> 8) % maximum; };
    try {
      ports.configure({ recording: true });
      for (let index = 0; index < 1000; index++) {
        const event = { timestamp: index % 1000, data: [0xb0, 74, index % 128], outputId: null, intentRenderId: null };
        ports.recordEvent({ type: 'cc', channel: 1, controller: 74, value: index % 128, timestamp: event.timestamp, beat: 0 }); records.push(event);
      }
      for (let phase = 0; phase < 16; phase++) {
        now += random(100);
        for (let index = 0; index < 64; index++) {
          const channel = 1 + random(2), note = 60 + random(2), outputId = random(2) ? 'A' : 'B', timestamp = now + [-300, -100, 0, 50, 500][random(5)], durationMs = [0, 1, 100, 400, 900][random(5)], id = ++nextId;
          expect(ports.recordOutput({ channel, note, outputId, velocity: 90, releaseVelocity: 17, timeMs: timestamp, durationMs }, { beat: timestamp / 500 })).to.equal(true);
          const start = { timestamp, data: [0x90 | (channel - 1), note, 90], outputId, intentRenderId: id }, end = durationMs ? { timestamp: timestamp + durationMs, data: [0x80 | (channel - 1), note, 17], outputId, intentRenderId: id } : null;
          records.push(start); if (end) records.push(end); pending.push({ start, end });
        }
        for (const { start, end } of pending) {
          if (start.timestamp > now) { start.cancelled = true; if (end) end.cancelled = true; }
          else if (!end || end.timestamp > now) {
            if (end) end.cancelled = true;
            records.push({ timestamp: now, data: [0x80 | (start.data[0] & 15), start.data[1], 0], outputId: start.outputId, intentRenderId: start.intentRenderId });
          }
        }
        pending.length = 0;
        if (phase % 2) ports.panic(); else ports.flush();
        const expected = publicRows(records.filter(row => !row.cancelled));
        expect(publicRows(ports.getRecording())).to.deep.equal(expected);
        const beforeRepeat = ports.getRecordingIndexState().scannedEvents; ports.flush();
        expect(publicRows(ports.getRecording())).to.deep.equal(expected); expect(ports.getRecordingIndexState().scannedEvents).to.equal(beforeRepeat);
      }
    } finally {
      const retirement = ports.dispose(); await retirement.completion;
      expect(retirement.outcome).to.equal('complete'); expect(budget.diagnostics().accountedBytes).to.equal(0);
    }
  });
});
