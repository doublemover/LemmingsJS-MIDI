import { formatMidiCaptureSummary, renderMidiCaptureReport } from '../../midi/capture/MidiCaptureAnalysis.js';
import { downloadTextFile } from '../editor-ui/editorUiFiles.js';

const createMidiCaptureControls = ({ document, window, capture, prefix, getMetadata, attach, inspect, download = downloadTextFile }) => {
  const byId = suffix => document?.getElementById(prefix + suffix);
  const listeners = []; let timer = null, disposed = false, metadataKey = '';
  const clearTimer = () => { if (timer != null) window?.clearTimeout?.(timer); timer = null; };
  const refresh = () => {
    clearTimer(); if (disposed) return;
    const state = capture.getState();
    attach?.(state.active ? capture : null);
    if (state.active) {
      const metadata = getMetadata?.() || {}, key = JSON.stringify(metadata);
      if (key !== metadataKey) { const settings = metadata.settingsReference || {};
        capture.record('context-change', { backend: metadata.backend, seed: metadata.seed, generation: metadata.generation,
          tempoBpm: metadata.tempoBpm, speed: metadata.speed, frameMs: metadata.frameMs,
          scaleName: metadata.scale?.name, scaleRoot: metadata.scale?.root, scaleDegrees: metadata.scale?.degrees,
          projectId: settings.projectId, projectUpdatedAt: settings.updatedAt, localMasterGain: settings.localMasterGain, preset: settings.preset, mode: settings.mode, pack: settings.pack, laneCount: settings.laneCount,
          trackIds: settings.tracks?.map(track => track.id), trackChannels: settings.tracks?.map(track => track.channel), trackPrograms: settings.tracks?.map(track => track.program), clipIds: settings.clipIds,
          reason: 'settings-or-backend-change', observationCadenceMs: 1000 }); metadataKey = key; }
    }
    const label = byId('Status');
    const text = (state.active ? 'Capturing' : 'Capture stopped') + ': ' + state.retained + '/' + state.capacity + ' records; ' + state.truncated + ' overwritten' + (state.stopReason ? ' / ' + state.stopReason : '') + '.';
    if (label && label.textContent !== text) label.textContent = text;
    if (byId('Start')) byId('Start').disabled = state.active;
    if (byId('Stop')) byId('Stop').disabled = !state.active;
    for (const suffix of ['JSONL', 'CSV', 'Report', 'HTML']) if (byId(suffix)) byId(suffix).disabled = !state.retained;
    if (state.active && typeof window?.setTimeout === 'function') timer = window.setTimeout(refresh, 1000);
  };
  const showReport = () => {
    inspect?.();
    const snapshot = capture.snapshot(), summary = byId('Summary'), report = byId('Roll');
    if (summary) { summary.textContent = formatMidiCaptureSummary(snapshot); summary.hidden = false; }
    if (report) { report.srcdoc = renderMidiCaptureReport(snapshot); report.hidden = false; report.scrollIntoView?.({ block: 'nearest' }); }
    refresh(); return snapshot;
  };
  const start = () => {
    const metadata = getMetadata?.() || {}; capture.start(metadata); metadataKey = JSON.stringify(metadata); attach?.(capture);
    for (const suffix of ['Summary', 'Roll']) if (byId(suffix)) byId(suffix).hidden = true;
    refresh(); return capture.getState();
  };
  const stop = () => { capture.stop('manual'); refresh(); return capture.getState(); };
  const exportCapture = format => {
    const text = format === 'jsonl' ? capture.toJSONL() : format === 'csv' ? capture.toCSV() : renderMidiCaptureReport(capture.snapshot());
    download(document, text, 'lemmings-output-capture.' + format, format === 'html' ? 'text/html' : format === 'csv' ? 'text/csv' : 'application/x-ndjson');
    refresh(); return text;
  };
  for (const [suffix, handler] of [['Start', start], ['Stop', stop], ['Report', showReport], ['JSONL', () => exportCapture('jsonl')], ['CSV', () => exportCapture('csv')], ['HTML', () => exportCapture('html')]]) {
    const element = byId(suffix); element?.addEventListener('click', handler); listeners.push([element, handler]);
  }
  refresh();
  return { start, stop, refresh, showReport, exportCapture,
    dispose() { disposed = true; clearTimer(); capture.stop('disposed'); attach?.(null); for (const [element, handler] of listeners) element?.removeEventListener('click', handler); } };
};
export { createMidiCaptureControls };
