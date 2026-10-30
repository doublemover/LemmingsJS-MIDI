const TYPES = new Set(['ready', 'preparing', 'started', 'result-ready', 'result', 'result-outcome-ack', 'telemetry', 'control-state', 'step-ready', 'done', 'fatal']);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const ingressError = message => Object.assign(new Error(message), { name: 'SurveyWorkerIngressError', kind: 'worker-ingress' });

export const encodeSurveyWorkerJson = (value, { maxBytes, maxNodes = 262144, maxDepth = 48 } = {}) => {
  let nodes = 0, minimumBytes = 0;
  const active = new Set();
  const visit = (item, depth) => {
    if (++nodes > maxNodes || depth > maxDepth || minimumBytes > maxBytes) throw ingressError('Worker JSON exceeds its structural or byte bound');
    if (item === null || typeof item === 'boolean') { minimumBytes += 4; return; }
    if (typeof item === 'number') { if (!Number.isFinite(item)) throw ingressError('Worker JSON contains a nonfinite number'); minimumBytes++; return; }
    if (typeof item === 'string') { minimumBytes += item.length + 2; return; }
    if (typeof item !== 'object' || !Array.isArray(item) && !plain(item) || active.has(item)) throw ingressError('Worker JSON contains an unsupported or cyclic value');
    active.add(item); minimumBytes += 2;
    if (Array.isArray(item)) {
      if (item.length > maxNodes - nodes) throw ingressError('Worker JSON array exceeds its entry bound');
      for (let index = 0; index < item.length; index++) {
        if (!Object.hasOwn(item, index) || item[index] === undefined) throw ingressError('Worker JSON array contains an absent value');
        minimumBytes++; visit(item[index], depth + 1);
      }
    } else for (const key of Object.keys(item)) {
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || ['__proto__', 'prototype', 'constructor'].includes(key)) throw ingressError('Worker JSON contains an unsupported property');
      if (descriptor.value === undefined) continue;
      minimumBytes += key.length + 4; visit(descriptor.value, depth + 1);
    }
    active.delete(item);
  };
  visit(value, 0);
  const encoded = JSON.stringify(value), bytes = Buffer.byteLength(encoded);
  if (bytes > maxBytes) throw ingressError('Worker JSON exceeds its encoded byte bound');
  return { encoded, bytes };
};

export const validateSurveyWorkerEnvelope = (message, runGeneration, workerGeneration) => {
  if (!plain(message) || Object.keys(message).length > 24) throw ingressError('Invalid worker message envelope');
  if (message.schemaVersion !== 1) throw ingressError('Unsupported worker message schema');
  if (message.runGeneration !== runGeneration || message.workerGeneration !== workerGeneration) throw ingressError('Invalid worker generation');
  if (!TYPES.has(message.type)) throw ingressError('Unknown worker message type');
  if (['telemetry', 'control-state'].includes(message.type) && !plain(message.value) ||
      message.type === 'step-ready' && (!Array.isArray(message.selected) || message.selected.length > 64) ||
      message.type === 'fatal' && (typeof message.error !== 'string' || message.error.length > 4096)) throw ingressError('Invalid worker nested message envelope');
  if (['preparing', 'started', 'result-ready', 'result-outcome-ack', 'telemetry'].includes(message.type) &&
      (typeof message.trialId !== 'string' || !message.trialId || message.trialId.length > 256)) throw ingressError('Invalid worker trial envelope');
  // Result graphs are traversed only after assignment and transfer admission.
  if (message.type === 'result') {
    if (!plain(message.result) || typeof message.result.trialId !== 'string' || message.result.trialId.length > 256 ||
        typeof message.attemptId !== 'string' || !message.attemptId || message.attemptId.length > 256) throw ingressError('Invalid worker result envelope');
    return message;
  }
  encodeSurveyWorkerJson(message, { maxBytes: 65536, maxNodes: 8192 });
  return message;
};
