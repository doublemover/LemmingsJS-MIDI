import fs from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { installWebMidiStub } from '../e2e/helpers/webmidiStub.js';
import { installExternalAssetStubs } from '../e2e/helpers/externalAssets.js';
import { writeMidiCaptureArtifacts } from './midi-capture-fixture.js';

const url = process.argv.find(arg => arg.startsWith('--url='))?.slice(6) || 'http://localhost:8094/?e2e=1&midi=1';
const directory = process.argv.find(arg => arg.startsWith('--out-dir='))?.slice(10) || 'temp/midi-capture-native';
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--mute-audio'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage(), errors = [];
page.setDefaultTimeout(5000);
page.on('pageerror', error => errors.push(error.message));
await installWebMidiStub(page); await installExternalAssetStubs(page);
const results = {};
try {
  await page.goto(url); await page.waitForFunction(() => window.__E2E__?.getState().ready);
  await page.evaluate(() => window.__E2E__.pause());
  if (!await page.locator('#midiSequencerWorkspace').isVisible()) await page.locator('#midiWorkspaceToggle').click();
  await page.locator('#midiLocalListenButton').click();
  await page.waitForFunction(() => window.__LEMMINGS_MIDI_UI__?.getLocalAudioState().monitor?.enabled);
  await page.evaluate(() => { window.__LEMMINGS_MIDI_UI__.startOutputCapture(); window.__E2E__.resume(); });
  await page.waitForTimeout(4500);
  await page.evaluate(() => window.__E2E__.pause());
  await page.locator('#midiViewExpert').click();
  const details = page.locator('#midiCaptureReport').locator('xpath=ancestor::details[1]');
  if (!await details.evaluate(element => element.open)) await details.locator('summary').click();
  await page.evaluate(() => document.getElementById('midiCaptureReport').click()); await page.waitForTimeout(100);
  await page.evaluate(() => document.getElementById('midiCaptureReport').click());
  await page.evaluate(() => window.__LEMMINGS_MIDI_UI__.panic());
  await page.evaluate(() => window.__LEMMINGS_MIDI_UI__.stopOutputCapture());
  const level = await page.evaluate(() => window.__LEMMINGS_MIDI_UI__.getOutputCapture().snapshot());
  results.level = await writeMidiCaptureArtifacts(level, directory + '/actual-level');

  await page.evaluate(() => {
    const api = window.__LEMMINGS_MIDI_UI__, project = api.getProject();
    const source = project.sources.find(source => source.kind === 'sfx');
    const clipId = 'capture-long-audition', pitches = [62, 64, 65, 67, 69, 71, 72, 74];
    project.clips.push({ id: clipId, name: '16-cell capture fixture', type: 'step', lengthSteps: 16,
      playback: { advance: 'game-tick', spacingTicks: 8, passCounter: 'started' },
      steps: Array.from({ length: 16 }, (_, index) => ({ index, note: pitches[index % pitches.length], velocity: 96, durationTicks: 2, probability: 1, hold: false, tie: false })) });
    source.mode = 'clip'; source.clipId = clipId;
    project.ui.selectedSourceId = source.id; project.ui.selectedTrackId = source.trackId; project.ui.selectedClipId = clipId;
    api.setProject(project); window.__E2E__.setSpeed(0.5); window.__E2E__.pause();
    api.startOutputCapture();
  });
  await page.locator('#midiSoundPreview').click();
  await page.waitForFunction(() => window.__LEMMINGS_MIDI_UI__.getOutputCapture().snapshot().records.some(record => record.stage === 'synth-scheduled' && record.eventType === 'audition'));
  await page.waitForFunction(() => !document.getElementById('midiCaptureReport').disabled);
  await page.evaluate(() => document.getElementById('midiCaptureReport').click());
  const renderWaitMs = await page.evaluate(() => {
    const records = window.__LEMMINGS_MIDI_UI__.getOutputCapture().snapshot().records, now = performance.now();
    const onset = records.find(record => record.stage === 'request' && record.eventType === 'audition' && record.intendedMs > now + 150)?.intendedMs;
    return onset == null ? 100 : Math.max(0, onset + 100 - now);
  });
  await page.waitForTimeout(renderWaitMs);
  await page.evaluate(() => document.getElementById('midiCaptureReport').click());
  await page.waitForTimeout(15000);
  await page.evaluate(() => { window.__LEMMINGS_MIDI_UI__.panic(); window.__LEMMINGS_MIDI_UI__.stopOutputCapture(); });
  const audition = await page.evaluate(() => window.__LEMMINGS_MIDI_UI__.getOutputCapture().snapshot());
  results.audition = await writeMidiCaptureArtifacts(audition, directory + '/long-audition');
  const sources = audition.records.filter(record => record.stage === 'synth-scheduled');
  results.auditionSpanMs = sources.at(-1)?.scheduledMs - sources[0]?.scheduledMs;

  await page.evaluate(() => window.__LEMMINGS_MIDI_UI__.startOutputCapture());
  await page.locator('#midiSoundPreview').click();
  await page.evaluate(() => window.__LEMMINGS_MIDI_UI__.panic());
  const before = await page.evaluate(() => window.__LEMMINGS_MIDI_UI__.getOutputCapture().snapshot().records.filter(record => record.stage === 'synth-scheduled').length);
  await page.waitForTimeout(4500);
  await page.evaluate(() => window.__LEMMINGS_MIDI_UI__.stopOutputCapture());
  const cancellation = await page.evaluate(() => window.__LEMMINGS_MIDI_UI__.getOutputCapture().snapshot());
  results.cancellation = await writeMidiCaptureArtifacts(cancellation, directory + '/cancelled-audition');
  results.cancelledScheduledAfterStop = cancellation.records.filter(record => record.stage === 'synth-scheduled').length - before;
  results.externalEnabled = await page.evaluate(() => window.WebMidi?.enabled || false);
  results.errors = errors;
  await page.evaluate(() => document.getElementById('midiCaptureReport').click());
  await fs.mkdir(directory, { recursive: true });
  await page.screenshot({ path: directory + '/desktop.png' });
  const compact = report => ({ records: report.records, noteOns: report.noteOns, synthSchedules: report.synthSchedules,
    synthEnds: report.synthEnds, openNotes: report.openNotes.length, outsideScale: report.outsideScale,
    renderedRms: report.renderSamples.map(sample => sample.rms), truncated: report.truncated });
  const evidence = { level: compact(results.level), audition: compact(results.audition), auditionSpanMs: results.auditionSpanMs,
    cancellation: compact(results.cancellation), cancelledScheduledAfterStop: results.cancelledScheduledAfterStop,
    externalEnabled: results.externalEnabled, errors };
  await fs.writeFile(directory + '/evidence.json', JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence));
  if (results.audition.noteOns !== 16 || results.audition.synthSchedules !== 16 || Math.abs(results.auditionSpanMs - 14400) > 100 ||
    !results.audition.renderSamples.some(sample => sample.rms > 0.00001) || results.cancelledScheduledAfterStop || results.externalEnabled || errors.length) {
    throw new Error('Native capture evidence failed a bounded output/render assertion');
  }
} finally { await context.close(); await browser.close(); }
