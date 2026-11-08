import { cloneData, freezeData } from '../../../core/CanonicalData.js';
const fail = message => { throw new Error('Counterfactual projection: ' + message); };
export function encodePhysicalCounterfactualFrame(projection, baseTick) {
  const cells = projection?.cells, view = projection?.viewport;
  if (!(cells instanceof Uint8Array) || !view || cells.length !== view.pixelWidth * view.pixelHeight || cells.length > 16384 || !Number.isSafeInteger(baseTick) || projection.tick < baseTick) fail('use one bounded actual completed projection.');
  const runs = [];
  for (let index = 0; index < cells.length;) { const cell = cells[index]; if (cell > 3) fail('unknown collision sample encoding.'); let end = index + 1; while (end < cells.length && cells[end] === cell) end++; runs.push(cell, end - index); index = end; if (runs.length > 4096) fail('the actual collision pattern exceeds the2048-run frame profile.'); }
  const { cells: _pixels, actors, ...metadata } = projection;
  return freezeData({ schema: 'lemmings-physical-counterfactual-frame/v1', relativeTick: projection.tick - baseTick, projection: cloneData({ ...metadata, actors: actors.slice(0, 64), omittedActors: projection.omittedActors + Math.max(0, actors.length - 64) }, { maxBytes: 65536, maxNodes: 8192 }), cellRuns: runs });
}
export function decodePhysicalCounterfactualFrame(frame) {
  const projection = frame?.projection, view = projection?.viewport, count = view?.pixelWidth * view?.pixelHeight;
  if (frame?.schema !== 'lemmings-physical-counterfactual-frame/v1' || !Number.isSafeInteger(count) || count < 4096 || count > 16384 || !Number.isSafeInteger(view.pixelWidth) || !Number.isSafeInteger(view.pixelHeight) || view.pixelWidth < 64 || view.pixelWidth > 128 || view.pixelHeight < 64 || view.pixelHeight > 128 || !Array.isArray(frame.cellRuns) || frame.cellRuns.length > 4096 || frame.cellRuns.length % 2) fail('invalid bounded frame.');
  const cells = new Uint8Array(count); let offset = 0;
  for (let index = 0; index < frame.cellRuns.length; index += 2) { const value = frame.cellRuns[index], length = frame.cellRuns[index + 1]; if (!Number.isSafeInteger(value) || value < 0 || value > 3 || !Number.isSafeInteger(length) || length < 1 || offset + length > count) fail('invalid collision run.'); cells.fill(value, offset, offset + length); offset += length; }
  if (offset !== count) fail('incomplete collision frame.'); return Object.freeze({ ...projection, cells });
}
