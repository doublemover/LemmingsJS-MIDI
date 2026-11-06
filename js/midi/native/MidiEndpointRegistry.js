import { createDeviceMutationOwner } from './DeviceMutation.js';

const mask = block => block.active && block.groupCount > 0 && block.firstGroup + block.groupCount <= 16 ? ((1 << block.groupCount) - 1) << block.firstGroup : 0;
const semanticBlock = block => JSON.stringify([block.active, block.direction, block.midi1, block.firstGroup, block.groupCount, block.ciVersion, block.maximumSysex8Streams]);
export function createMidiEndpointRegistry({ routes, inputGrant, outputGrant, now = () => performance.now(), timeoutMs = 1500 } = {}) {
  const initial = routes.state(), input = initial.grants.find(row => row.grant === inputGrant), output = initial.grants.find(row => row.grant === outputGrant), ingress = routes.input.scope(inputGrant);
  if (!input || !output || input.direction !== 'input' || output.direction !== 'output' || !(input.permissions & 8) || !(output.permissions & 8) || !ingress ||
      input.endpointAssociationToken && output.endpointAssociationToken && input.endpointAssociationToken !== output.endpointAssociationToken ||
      !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 5000) throw new Error('Choose endpoint-control input/output grants on the same native endpoint');
  const blocks = new Map(), names = new Map(), listeners = new Set(), receive = [];
  let timingReady = false, preparingTiming = null;
  let disposed = false, stale = false, epoch = 1, revision = 0, info = null, configuration = null, identity = null, endpointName = null, productInstanceId = null;
  let queueBytes = 0, receiving = false, receiveTail = Promise.resolve(), disposal = null, discovery = null, pendingConfiguration = null, sendTail = Promise.resolve(), lastDiscoveryMs = -Infinity, reason = null;
  const ownership = Object.freeze({ state: () => Object.freeze({ epoch, inputGrant, outputGrant, connectionEpoch: initial.connectionEpoch }) });
  const mutation = createDeviceMutationOwner({ routes, ci: ownership, now });
  const current = () => !disposed && !stale && routes.client.session === initial.connectionEpoch && routes.isGrantActive(inputGrant) && routes.isGrantActive(outputGrant) && routes.input.scope(inputGrant)?.ingressEpoch === ingress.ingressEpoch;
  const emit = () => { for (const listener of listeners) { try { listener(); } catch {} } };
  const invalidateRoutes = (why, groups = null) => { if (groups === 0) return; void (groups ? routes.invalidateDeviceGroups(outputGrant, groups, why) : routes.invalidateDeviceState(outputGrant, why)).catch(error => { reason = error.message; emit(); }); };
  const finishDiscovery = outcome => { if (!discovery) return; const task = discovery; discovery = null; clearTimeout(task.timer); task.resolve(Object.freeze(outcome)); emit(); };
  const finishConfiguration = outcome => { if (!pendingConfiguration) return; const task = pendingConfiguration; pendingConfiguration = null; clearTimeout(task.timer); task.resolve(Object.freeze(outcome)); emit(); };
  const lose = why => {
    if (stale || disposed) return; stale = true; epoch++; reason = why;
    finishDiscovery({ status: 'stale', reason: why }); finishConfiguration({ status: 'stale', reason: why, receiverState: 'unknown' });
    mutation.cancel(); receive.length = queueBytes = 0; invalidateRoutes(why); emit();
  };
  const validateBlock = value => {
    if (!Number.isInteger(value.number) || value.number < 0 || value.number > 31 || typeof value.active !== 'boolean' ||
        !Number.isInteger(value.direction) || value.direction < 0 || value.direction > 3 || !Number.isInteger(value.midi1) || value.midi1 < 0 || value.midi1 > 2 ||
        !Number.isInteger(value.firstGroup) || !Number.isInteger(value.groupCount) || !Number.isInteger(value.ciVersion) || value.ciVersion < 0 || value.ciVersion > 127 ||
        !Number.isInteger(value.maximumSysex8Streams) || value.maximumSysex8Streams < 0 || value.maximumSysex8Streams > 255 ||
        value.active && (!value.direction || value.firstGroup < 0 || value.firstGroup > 15 || value.groupCount < 1 || value.groupCount > 16 || value.firstGroup + value.groupCount > 16 || value.midi1 && value.groupCount !== 1)) throw new Error('Malformed endpoint function-block metadata');
    return Object.freeze({ number: value.number, active: value.active, direction: value.direction, midi1: value.midi1, uiHint: value.uiHint ?? 0,
      firstGroup: value.firstGroup, groupCount: value.groupCount, ciVersion: value.ciVersion, maximumSysex8Streams: value.maximumSysex8Streams, name: names.get(value.number) || value.name || null });
  };
  const complete = () => info && configuration && blocks.size === info.functionBlockCount;
  const onMetadata = () => { revision++; if (discovery && complete()) finishDiscovery({ status: 'ok', evidence: info.source, functionBlocks: blocks.size }); emit(); };
  const setInfo = (value, source) => {
    if (!Number.isInteger(value.umpMajor) || !Number.isInteger(value.umpMinor) || !Number.isInteger(value.functionBlockCount) || value.functionBlockCount < 0 || value.functionBlockCount > 32 ||
        typeof value.staticFunctionBlocks !== 'boolean' || !Number.isInteger(value.supportedProtocols) || value.supportedProtocols < 1 || value.supportedProtocols > 3 ||
        !Number.isInteger(value.jrCapabilities) || value.jrCapabilities < 0 || value.jrCapabilities > 3) throw new Error('Malformed endpoint capability metadata');
    const next = Object.freeze({ umpMajor: value.umpMajor, umpMinor: value.umpMinor, functionBlockCount: value.functionBlockCount, staticFunctionBlocks: value.staticFunctionBlocks,
      supportedProtocols: value.supportedProtocols, jrCapabilities: value.jrCapabilities, source, observedHostMs: now() });
    const changed = info && JSON.stringify([info.umpMajor, info.umpMinor, info.staticFunctionBlocks, info.supportedProtocols, info.jrCapabilities]) !==
      JSON.stringify([next.umpMajor, next.umpMinor, next.staticFunctionBlocks, next.supportedProtocols, next.jrCapabilities]);
    info = next;
    let removedGroups = 0; for (const number of blocks.keys()) if (number >= next.functionBlockCount) { removedGroups |= mask(blocks.get(number)); blocks.delete(number); names.delete(number); }
    if (removedGroups && !changed) invalidateRoutes('function-blocks-removed', removedGroups);
    if (changed) invalidateRoutes('endpoint-capabilities-changed'); onMetadata();
  };
  const setConfiguration = (protocol, extensions, source) => {
    if (![1, 2].includes(protocol) || !Number.isInteger(extensions) || extensions < 0 || extensions > 3 || info && !(info.supportedProtocols & protocol)) throw new Error('Unsupported or malformed active Stream configuration');
    const changed = configuration && (configuration.protocol !== protocol || configuration.extensions !== extensions);
    timingReady = false;
    configuration = Object.freeze({ protocol, extensions, jrSends: !!(extensions & 1), jrReceives: !!(extensions & 2), source, observedHostMs: now() });
    routes.input.configureJr(inputGrant, configuration.jrSends, source);
    if (pendingConfiguration) finishConfiguration({ status: pendingConfiguration.protocol === protocol && pendingConfiguration.extensions === extensions ? 'ok' : 'refused',
      receiverState: 'stream-configuration-notified', configuration, reason: pendingConfiguration.protocol === protocol && pendingConfiguration.extensions === extensions ? null : 'Endpoint selected a different Stream configuration' });
    else if (changed) invalidateRoutes('active-stream-configuration-changed');
    onMetadata();
  };
  const accept = value => {
    if (value.kind === 'text') {
      const message = value.message, maximum = ({ 3: 98, 4: 42, 18: 91 })[message.status];
      if (!maximum || new TextEncoder().encode(message.text).length > maximum) throw new Error('Endpoint text metadata capacity');
      if (message.status === 3) endpointName = message.text;
      else if (message.status === 4) productInstanceId = message.text;
      else {
        if (!Number.isInteger(message.functionBlock) || message.functionBlock < 0 || message.functionBlock > 31) throw new Error('Invalid function-block text scope');
        names.set(message.functionBlock, message.text); const previous = blocks.get(message.functionBlock); if (previous) blocks.set(message.functionBlock, Object.freeze({ ...previous, name: message.text }));
      }
      onMetadata(); return;
    }
    const message = value.message;
    if (!message.known) return;
    if (message.status === 1) setInfo(message, 'native-stream-notification');
    else if (message.status === 2) { identity = Object.freeze({ ...message.identity }); onMetadata(); }
    else if (message.status === 6) setConfiguration(message.protocol, message.extensions, 'native-stream-notification');
    else if (message.status === 17) {
      const block = validateBlock(message), previous = blocks.get(block.number);
      if (info && block.number >= info.functionBlockCount) throw new Error('Function-block number exceeds endpoint declaration');
      if (info?.staticFunctionBlocks && !block.active) throw new Error('Static endpoint reported an inactive function block');
      blocks.set(block.number, block); if (previous && semanticBlock(previous) !== semanticBlock(block)) invalidateRoutes('function-block-layout-changed', mask(previous) | mask(block)); onMetadata();
    }
  };
  const drain = async () => {
    if (receiving) return; receiving = true;
    try {
      while (receive.length && current()) {
        const entry = receive.shift(); queueBytes -= entry.bytes;
        try { if (entry.text) accept({ kind: 'text', message: entry.text }); else { const message = await routes.client.decodeStream(inputGrant, entry.words); if (current()) accept({ message }); } }
        catch (error) { if (current()) { reason = error.message; finishDiscovery({ status: 'malformed', reason }); finishConfiguration({ status: 'malformed', reason, receiverState: 'unknown' }); emit(); } }
      }
    } finally { receiving = false; }
  };
  const unsubscribe = routes.input.subscribe(event => {
    if (event.grant !== inputGrant) return;
    if (event.event === 'ingress-loss') { lose(event.reason); return; }
    let entry;
    if (event.event === 'native-packet' && event.packet.kind === 'stream' && ![3, 4, 18].includes(event.packet.status)) entry = { words: event.packet.words, bytes: 64 };
    if (event.event === 'native-payload' && event.message.kind === 'stream-text') entry = { text: event.message, bytes: 256 + event.message.payload.length * 2 };
    if (!entry) return;
    if (!current()) return;
    if (receive.length >= 64 || queueBytes + entry.bytes > 16384) { lose('Endpoint metadata receive capacity'); return; }
    receive.push(entry); queueBytes += entry.bytes; if (!receiving) receiveTail = drain();
  });
  const applyOsMetadata = seed => {
    if (seed?.source !== 'windows-midi-services-declared' || !Array.isArray(seed.functionBlocks) || seed.functionBlocks.length > 32) throw new Error('OS function-block metadata is unavailable or excessive');
    const next = new Map();
    for (const row of seed.functionBlocks) { const block = validateBlock(row); if (next.has(block.number)) throw new Error('Duplicate OS function block'); next.set(block.number, block); }
    if (seed.umpMajor != null) setInfo(seed, seed.source);
    let affected = 0;
    for (const [number, old] of blocks) { const replacement = next.get(number); if (!replacement || semanticBlock(old) !== semanticBlock(replacement)) affected |= mask(old) | (replacement ? mask(replacement) : 0); }
    blocks.clear(); names.clear(); for (const [number, block] of next) { blocks.set(number, block); if (block.name) names.set(number, block.name); }
    if (affected) invalidateRoutes('OS-function-block-layout-changed', affected);
    if (seed.activeProtocol != null && (configuration?.protocol !== seed.activeProtocol || configuration?.extensions !== seed.activeExtensions)) setConfiguration(seed.activeProtocol, seed.activeExtensions, seed.source);
    onMetadata();
  };
  const seed = output.endpointMetadata;
  if (seed?.source === 'windows-midi-services-declared') {
    try { applyOsMetadata(seed); }
    catch (error) { info = configuration = null; blocks.clear(); names.clear(); reason = 'OS endpoint metadata is incomplete: ' + error.message; }
  }
  const send = (operation, parameters, wireExecution, owns = current) => {
    const task = sendTail.then(async () => {
      if (!current() || !owns()) throw new Error('Endpoint control scope retired');
      const encoded = await routes.client.encodeStream(outputGrant, { operation, parameters });
      if (!current() || !owns() || !Array.isArray(encoded.words) || encoded.words.length !== 4) throw new Error('Endpoint control retired or codec unavailable');
      const words = encoded.words, provenance = Object.freeze({ schema: 'lemmings-ump-endpoint-control/v1', operation, inputGrant, outputGrant, connectionEpoch: initial.connectionEpoch, epoch });
      let receipt;
      try { receipt = await routes.client.sendBatch({ grant: outputGrant, execution: wireExecution, priority: 2, targetTimeMs: routes.client.now() + 10, words, provenance }); }
      catch (error) { routes.recordSubmission({ words, provenance, receipt: { session: initial.connectionEpoch, grant: outputGrant, execution: wireExecution, kind: 'error', acceptedWords: 0, acceptedPackets: 0, failedPacketUnconfirmed: error.notSubmitted !== true, submissionExtent: error.notSubmitted === true ? 'observed-prefix' : 'unobserved-batch', reason: error.message } }); throw error; }
      routes.recordSubmission({ words, provenance, receipt }); if (receipt.kind !== 'driver-submitted') throw new Error(receipt.reason || 'Endpoint control submission failed');
    }); sendTail = task.catch(() => {}); return task;
  };
  const fence = async wireExecution => {
    if (routes.client.session !== initial.connectionEpoch || !routes.isGrantActive(outputGrant)) return;
    try { const receipt = await routes.client.cancelExecution(outputGrant, wireExecution); if (receipt.kind !== 'cancelled-execution' || (receipt.cleanupUnconfirmedNotes || receipt.cleanupUnconfirmedControls) || receipt.protocolStateConfirmed === false) throw new Error('Endpoint control cancellation is unconfirmed'); }
    catch (error) { routes.quarantineDeviceState(outputGrant, error.message); throw error; }
  };
  const api = Object.freeze({
    refreshMetadata(seed) { if (!current()) return; try { applyOsMetadata(seed); } catch (error) { reason = error.message; emit(); } },
    async discover() {
      if (routes.client.capabilities?.endpointDiscoveryOwner === 'os') return Object.freeze({ status: complete() ? 'ok' : 'incomplete', evidence: info?.source || 'os-managed', reason: complete() ? null : 'Windows endpoint metadata is incomplete; refresh native devices when its discovery completes' });
      if (!current() || discovery || now() - lastDiscoveryMs < 2000 || routes.client.capabilities?.umpStreamCodecVersion !== 1) return Object.freeze({ status: 'rejected', reason: 'Endpoint discovery is stale, busy or rate limited' });
      lastDiscoveryMs = now(); const wireExecution = routes.allocateExecutionEpoch(); let resolve;
      const completion = new Promise(done => { resolve = done; }), task = { resolve, timer: null }; discovery = task;
      task.timer = setTimeout(() => { if (discovery === task) finishDiscovery({ status: complete() ? 'ok' : 'incomplete', reason: complete() ? null : 'Endpoint metadata remains incomplete after discovery', evidence: info?.source || 'unknown', functionBlocks: blocks.size }); }, timeoutMs);
      try { await send('endpoint-discovery', [31], wireExecution, () => discovery === task); if (discovery === task) await send('function-block-discovery', [255, 3], wireExecution, () => discovery === task); }
      catch (error) { if (discovery === task) finishDiscovery({ status: 'incomplete', reason: error.message }); }
      const result = await completion; await fence(wireExecution); return result;
    },
    async configure({ protocol, extensions = 0, confirmed = false }) {
      if (routes.client.capabilities?.endpointDiscoveryOwner === 'os') return Object.freeze({ status: 'unsupported', reason: 'Windows MIDI Services owns endpoint protocol and JR negotiation' });
      if (!current() || discovery || pendingConfiguration || ![1, 2].includes(protocol) || !Number.isInteger(extensions) || extensions < 0 || extensions > 3 ||
          !info || !(info.supportedProtocols & protocol) || ![0, 2].includes(extensions) || extensions && routes.client.capabilities?.nativeJrAllowed !== true || extensions & ~info.jrCapabilities) return Object.freeze({ status: 'unsupported', reason: 'Discover supported endpoint protocol and JR capabilities first' });
      const wireExecution = routes.allocateExecutionEpoch();
      return mutation.run({ requested: { kind: 'stream-configuration', protocol, extensions }, confirmed, isCurrent: current,
        send: async owns => {
          let resolve; const completion = new Promise(done => { resolve = done; }), task = { resolve, protocol, extensions, timer: null }; pendingConfiguration = task;
          task.timer = setTimeout(() => { if (pendingConfiguration === task) finishConfiguration({ status: 'timeout', reason: 'No Stream Configuration Notification confirmed the request', receiverState: 'unknown' }); }, timeoutMs);
          try { await send('stream-configuration', [protocol, extensions], wireExecution, owns); const outcome = await completion; if (outcome.status === 'ok') await api.prepareOutput(); return outcome; }
          catch (error) { if (pendingConfiguration === task) finishConfiguration({ status: 'incomplete', reason: error.message, receiverState: 'unknown' }); return Object.freeze({ status: 'incomplete', reason: error.message, receiverState: 'unknown' }); }
          finally { await fence(wireExecution); }
        }
      });
    },
    prepareOutput() {
      if (!current()) return Promise.reject(new Error('Endpoint metadata scope is stale'));
      if (!configuration) return Promise.resolve();
      if (routes.client.capabilities?.nativeJrAllowed !== true && !configuration.jrReceives) { timingReady = true; return Promise.resolve(); }
      if (timingReady) return Promise.resolve(); if (preparingTiming) return preparingTiming;
      if (routes.client.capabilities?.nativeJrAllowed !== true || routes.client.capabilities?.jrEncoderVersion !== 1) return Promise.reject(new Error('This backend cannot supply the endpoint’s required JR timestamps'));
      const selected = configuration;
      preparingTiming = routes.client.setJrMode(outputGrant, selected.jrReceives).then(receipt => { if (!current() || selected !== configuration || receipt.kind !== 'jr-policy' || receipt.enabled !== selected.jrReceives) throw new Error('JR timing policy was not activated for the current endpoint'); timingReady = true; emit(); }).finally(() => { preparingTiming = null; });
      return preparingTiming;
    },
    resolvePropertyChannel(functionBlock, propertyChannel) {
      const block = blocks.get(functionBlock);
      if (!current() || !info || !block?.active || !(block.direction & 1) || !Number.isInteger(propertyChannel) || propertyChannel < 1 || propertyChannel > block.groupCount * 16) return null;
      const index = propertyChannel - 1, group = block.firstGroup + (index >> 4); if (!(output.groupMask & 1 << group)) return null;
      return Object.freeze({ inputGrant, outputGrant, connectionEpoch: initial.connectionEpoch, registryRevision: revision, functionBlock, propertyChannel, group, channel: index & 15,
        evidence: info.source, endpointAssociation: input.endpointAssociationToken && input.endpointAssociationToken === output.endpointAssociationToken ? 'OS-associated-endpoint' : 'user-selected-input-output-pair' });
    },
    allowsAddress({ group, protocol }) {
      if (!current() || configuration?.jrReceives && !timingReady) return false; const requested = protocol === 'midi2' ? 2 : 1;
      if (info && !(info.supportedProtocols & requested)) return false;
      const destinations = [...blocks.values()].filter(block => block.active && block.direction & 1 && mask(block) & 1 << group);
      if (info && blocks.size === info.functionBlockCount && !destinations.length) return false;
      if (configuration && configuration.protocol !== requested && !(configuration.protocol === 2 && requested === 1 && destinations.some(block => block.midi1))) return false;
      return true;
    },
    state: () => Object.freeze({ disposed, stale: !current(), epoch, revision, inputGrant, outputGrant, connectionEpoch: initial.connectionEpoch, info, configuration, identity, endpointName,
      productInstanceId: productInstanceId == null ? null : 'observed-private-identifier-not-exported', functionBlocks: Object.freeze([...blocks.values()].sort((a, b) => a.number - b.number)), complete: !!complete(),
      nativeTimingReady: timingReady, discoveryPending: !!discovery, configurationPending: !!pendingConfiguration, reason, mutation: mutation.state(), queuedPackets: receive.length, queueBytes }),
    subscribe(listener) { if (disposed || listeners.size >= 8 || typeof listener !== 'function') throw new Error('Endpoint registry observer capacity'); listeners.add(listener); return () => listeners.delete(listener); },
    cancel() { finishDiscovery({ status: 'cancelled', reason: 'Endpoint discovery cancelled' }); finishConfiguration({ status: 'cancelled', reason: 'Stream request cancelled', receiverState: 'unknown' }); mutation.cancel(); },
    dispose() { if (disposal) return disposal; api.cancel(); disposed = true; epoch++; unsubscribe(); receive.length = queueBytes = 0; disposal = Promise.allSettled([sendTail, receiveTail, mutation.dispose()]).then(() => { listeners.clear(); blocks.clear(); names.clear(); productInstanceId = null; }); return disposal; }
  });
  const removeMutation = mutation.subscribe(emit); const originalDispose = api.dispose;
  return Object.freeze({ ...api, dispose() { removeMutation(); return originalDispose(); } });
}
