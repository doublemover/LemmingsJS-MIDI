/**
 * @param {{count: number, outputIds: string[], routeCounts?: Uint32Array}} snapshot
 * @param {{sourceLayer?: 'auto'|'api-accepted'|'intent-render', outputRouteId?: string}} options
 * @param {Uint32Array} [counts]
 */
export function planRecordedMidiExport(snapshot, options = {}, counts = snapshot?.routeCounts) {
  if (!Number.isSafeInteger(snapshot?.count) || snapshot.count < 0 || snapshot.count > 2000000 || !Array.isArray(snapshot.outputIds) || snapshot.outputIds.length > 4096 || snapshot.outputIds.some(id => typeof id !== 'string' || id.length > 4096) ||
      new Set(snapshot.outputIds).size !== snapshot.outputIds.length || !(counts instanceof Uint32Array) || !(counts.buffer instanceof ArrayBuffer) || counts.length !== snapshot.outputIds.length * 2)
    throw new TypeError('MIDI export requires its bounded recorded-route inventory.');
  const requested = options.sourceLayer ?? 'auto';
  if (!['auto', 'api-accepted', 'intent-render'].includes(requested)) throw new RangeError('Select recorded output or authored MIDI intent explicitly.');
  let submitted = 0, planned = 0;
  for (let index = 0; index < counts.length; index += 2) { submitted += counts[index]; planned += counts[index + 1]; }
  if (submitted + planned > snapshot.count) throw new RangeError('Recorded-route inventory exceeds its source prefix.');
  const evidence = requested === 'auto' ? submitted ? 'api-accepted' : 'intent-render' : requested, kind = evidence === 'api-accepted' ? 0 : 1;
  const routes = [];
  for (let index = 0; index < snapshot.outputIds.length; index++) if (counts[index * 2 + kind]) routes.push(Object.freeze({ outputId: snapshot.outputIds[index], index, messages: counts[index * 2 + kind] }));
  const selected = options.outputRouteId === undefined ? routes.length === 1 ? routes[0] : null : routes.find(route => route.outputId === options.outputRouteId);
  if (routes.length > 1 && options.outputRouteId === undefined) throw Object.assign(new Error('Choose one recorded output route before preparing a MIDI file. Endpoints cannot share one compatibility channel namespace.'),
    { code: 'midi-export-route-selection-required', routes: Object.freeze(routes), evidence });
  if (options.outputRouteId !== undefined && !selected) throw new RangeError('The selected output route is absent from this recorded source layer.');
  if (requested !== 'auto' && !routes.length && submitted + planned) throw new RangeError('The selected MIDI source layer has no recorded messages.');
  return Object.freeze({ schema: 'procgen-recorded-midi-export-plan/v1', sourceLayer: evidence, timeDomain: 'recorded-score-beat', placement: 'retained-absolute-beat', originBeat: 0,
    endpointPolicy: 'single-recorded-output', channelPolicy: 'preserve-within-selected-output', protocol: 'captured-midi1-channel-bytes',
    routeIndex: selected?.index ?? null, routeCount: routes.length, selectedRouteOrdinal: selected ? routes.indexOf(selected) + 1 : null,
    includedMessages: selected?.messages ?? 0, excludedRouteMessages: (kind ? planned : submitted) - (selected?.messages ?? 0),
    excludedOtherLayerMessages: kind ? submitted : planned });
}
