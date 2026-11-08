/**
 * @param {{count: number, outputIds: string[], outputEpochs?: Float64Array, routeCounts?: Uint32Array, firstTempoBeat?: number}} snapshot
 * @param {{sourceLayer?: 'auto'|'api-accepted'|'intent-render', outputRouteId?: string, outputRouteIndex?: number, placement?: 'retained-absolute-beat'|'rebase-recording-start'}} options
 * @param {Uint32Array} [counts]
 * @param {number} [boundaryBeat]
 */
export function planRecordedMidiExport(snapshot, options = {}, counts = snapshot?.routeCounts, boundaryBeat = snapshot?.firstTempoBeat) {
  if (!Number.isSafeInteger(snapshot?.count) || snapshot.count < 0 || snapshot.count > 2000000 || !Array.isArray(snapshot.outputIds) || snapshot.outputIds.length > 4096 || snapshot.outputIds.some(id => typeof id !== 'string' || id.length > 4096) ||
      !(counts instanceof Uint32Array) || !(counts.buffer instanceof ArrayBuffer) || counts.length !== snapshot.outputIds.length * 2)
    throw new TypeError('MIDI export requires its bounded recorded-route inventory.');
  const epochs = snapshot.outputEpochs;
  if (epochs !== undefined && (!(epochs instanceof Float64Array) || !(epochs.buffer instanceof ArrayBuffer) || epochs.length !== snapshot.outputIds.length * 2 ||
      epochs.some(value => !Number.isSafeInteger(value) || value < -1))) throw new TypeError('MIDI export requires its bounded recorded-route epoch inventory.');
  const identities = new Set();
  for (let index = 0; index < snapshot.outputIds.length; index++) {
    const identity = JSON.stringify([snapshot.outputIds[index], epochs?.[index * 2] ?? -1, epochs?.[index * 2 + 1] ?? -1]);
    if (identities.has(identity)) throw new TypeError('MIDI export requires a unique recorded-route inventory.'); identities.add(identity);
  }
  const requested = options.sourceLayer ?? 'auto';
  if (!['auto', 'api-accepted', 'intent-render'].includes(requested)) throw new RangeError('Select recorded output or authored MIDI intent explicitly.');
  const placement = options.placement ?? 'retained-absolute-beat';
  if (!['retained-absolute-beat', 'rebase-recording-start'].includes(placement) || placement === 'rebase-recording-start' && (!Number.isFinite(boundaryBeat) || boundaryBeat < 0)) throw new RangeError('Rebased MIDI export requires its captured recording-start beat.');
  if (options.outputRouteIndex !== undefined && (!Number.isSafeInteger(options.outputRouteIndex) || options.outputRouteIndex < 0)) throw new RangeError('Select a recorded output epoch explicitly.');
  let submitted = 0, planned = 0;
  for (let index = 0; index < counts.length; index += 2) { submitted += counts[index]; planned += counts[index + 1]; }
  if (submitted + planned > snapshot.count) throw new RangeError('Recorded-route inventory exceeds its source prefix.');
  const evidence = requested === 'auto' ? submitted ? 'api-accepted' : 'intent-render' : requested, kind = evidence === 'api-accepted' ? 0 : 1;
  const routes = [];
  for (let index = 0; index < snapshot.outputIds.length; index++) if (counts[index * 2 + kind]) routes.push(Object.freeze({ outputId: snapshot.outputIds[index], index, messages: counts[index * 2 + kind],
    ...(epochs && (epochs[index * 2] >= 0 || epochs[index * 2 + 1] >= 0) ? { connectionEpoch: epochs[index * 2] < 0 ? null : epochs[index * 2], routeRevision: epochs[index * 2 + 1] < 0 ? null : epochs[index * 2 + 1] } : {}) }));
  const candidates = options.outputRouteId === undefined ? routes : routes.filter(route => route.outputId === options.outputRouteId);
  const selected = options.outputRouteIndex === undefined ? candidates.length === 1 ? candidates[0] : null : candidates.find(route => route.index === options.outputRouteIndex);
  if (candidates.length > 1 && options.outputRouteIndex === undefined) throw Object.assign(new Error('Choose one recorded output epoch before preparing a MIDI file. Endpoints and connections cannot share one compatibility channel namespace.'),
    { code: 'midi-export-route-selection-required', routes: Object.freeze(candidates), evidence });
  if ((options.outputRouteId !== undefined || options.outputRouteIndex !== undefined) && !selected) throw new RangeError('The selected output route is absent from this recorded source layer.');
  if (requested !== 'auto' && !routes.length && submitted + planned) throw new RangeError('The selected MIDI source layer has no recorded messages.');
  return Object.freeze({ schema: 'procgen-recorded-midi-export-plan/v1', sourceLayer: evidence, timeDomain: 'recorded-score-beat', placement, originBeat: placement === 'rebase-recording-start' ? boundaryBeat : 0,
    endpointPolicy: 'single-recorded-output', channelPolicy: 'preserve-within-selected-output', protocol: 'captured-midi1-channel-bytes',
    routeIndex: selected?.index ?? null, routeCount: routes.length, selectedRouteOrdinal: selected ? routes.indexOf(selected) + 1 : null,
    includedMessages: selected?.messages ?? 0, excludedRouteMessages: (kind ? planned : submitted) - (selected?.messages ?? 0),
    excludedOtherLayerMessages: kind ? submitted : planned,
    ...(selected && Object.hasOwn(selected, 'connectionEpoch') ? { connectionEpoch: selected.connectionEpoch, routeRevision: selected.routeRevision } : {}) });
}
