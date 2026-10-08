import { expect } from 'chai';
import { createMidiCaptureControls } from '../../js/app/midi-ui/midiCaptureControls.js';
import { createMidiOutputCapture } from '../../js/midi/capture/MidiOutputCapture.js';
import { TestDocument, createTestWindow } from '../helpers/test-dom.js';
import { registerElement } from '../support/dom-fixtures.js';
import { withFakeClockAndPerformance } from '../support/timers.js';
const fixture = clock => {
  const document = new TestDocument(), window = createTestWindow(document), exports = [], attachments = [];
  const metadata = { seed: 42, backend: 'no-active-output', scale: { name: 'dorian', root: 2, degrees: [0, 2, 3, 5, 7, 9, 10] }, settingsReference: { projectId: 'test', updatedAt: 1, tracks: [{ id: 'bass', channel: 2, program: 33 }] } };
  for (const suffix of ['Start', 'Stop', 'JSONL', 'CSV', 'Report', 'HTML', 'Status', 'Summary', 'Roll']) {
    const element = registerElement(document, suffix === 'Roll' ? 'iframe' : 'button', 'testCapture' + suffix);
    element.removeEventListener = (event, callback) => element.listeners.set(event, (element.listeners.get(event) || []).filter(fn => fn !== callback));
  }
  window.setTimeout = (callback, milliseconds) => setTimeout(callback, milliseconds); window.clearTimeout = timer => clearTimeout(timer);
  const capture = createMidiOutputCapture({ maxDurationMs: 1000, nowMs: () => clock.now });
  const controls = createMidiCaptureControls({ document, window, capture, prefix: 'testCapture',
    getMetadata: () => metadata, attach: value => attachments.push(value),
    download: (_document, text, filename) => exports.push({ text, filename }) });
  return { document, controls, capture, exports, attachments, metadata };
};
describe('bounded output capture controls', () => {
  it('observes a finite session and expires without starting playback or leaving a UI timer', async () => {
    await withFakeClockAndPerformance(async clock => {
      const f = fixture(clock); f.controls.start();
      f.capture.record('api-dispatch', { type: 'noteOn', channel: 2, note: 50, scheduledMs: 0 });
      expect(f.capture.snapshot().metadata.seed).to.equal(42);
      await clock.tickAsync(1000); expect(f.capture.getState().active).to.equal(false); expect(f.capture.getState().stopReason).to.equal('duration-limit');
      expect(f.document.getElementById('testCaptureStart').disabled).to.equal(false); expect(f.attachments.at(-1)).to.equal(null);
      f.controls.dispose(); expect(clock.countTimers()).to.equal(0);
    });
  });
  it('records changed context as bounded flat fields and detaches the stopped observer', async () => {
    await withFakeClockAndPerformance(async clock => {
      const f = fixture(clock); f.controls.start();
      f.metadata.backend = 'local-browser-audio'; f.metadata.settingsReference.updatedAt = 2;
      f.controls.refresh();
      const marker = f.capture.snapshot().records.find(record => record.stage === 'context-change');
      expect(marker).to.include({ backend: 'local-browser-audio', scaleName: 'dorian', scaleRoot: 2, projectId: 'test', projectUpdatedAt: 2 });
      expect(marker.scaleDegrees).to.deep.equal([0, 2, 3, 5, 7, 9, 10]);
      expect(marker.trackPrograms).to.deep.equal([33]);
      f.controls.stop(); expect(f.attachments.at(-1)).to.equal(null);
      f.controls.dispose(); expect(clock.countTimers()).to.equal(0);
    });
  });
  it('exports retained evidence and computes reports only on demand', async () => {
    await withFakeClockAndPerformance(async clock => {
      const f = fixture(clock); f.controls.start();
      f.capture.record('api-dispatch', { type: 'noteOn', channel: 2, note: 50, scheduledMs: 0, voiceId: 1 });
      f.capture.record('api-dispatch', { type: 'noteOff', channel: 2, note: 50, scheduledMs: 100, voiceId: 1 });
      f.controls.stop(); expect(f.document.getElementById('testCaptureSummary').hidden).to.equal(true);
      f.controls.showReport(); expect(f.document.getElementById('testCaptureRoll').srcdoc).to.include('Piano roll');
      expect(f.document.getElementById('testCaptureSummary').textContent).to.include('1 accepted note-on API calls');
      f.controls.exportCapture('jsonl'); f.controls.exportCapture('csv'); f.controls.exportCapture('html');
      expect(f.exports.map(item => item.filename)).to.deep.equal(['lemmings-output-capture.jsonl', 'lemmings-output-capture.csv', 'lemmings-output-capture.html']);
      expect(JSON.parse(f.exports[0].text.split('\n')[0]).metadata.seed).to.equal(42);
      f.controls.dispose(); expect(clock.countTimers()).to.equal(0);
    });
  });
});
