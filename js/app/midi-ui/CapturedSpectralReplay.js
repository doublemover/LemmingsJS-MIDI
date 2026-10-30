import { SPECTRAL_CAPTURE_POLICY, validateSpectralCaptureReceipt } from '../../midi/content/SpectralCaptureReceipt.js';

const fail = (code, message) => { throw Object.assign(new Error(message), { name: 'EffectRenderError', code }); };
export function prepareCapturedSpectralReplay({ packets, publication, plan, frameOrigin, sampleRate }) {
  const nodes = new Map(plan.nodes.filter(node => node.spectral).map(node => [node.id, node]));
  if (publication.spectralCapturePolicy !== SPECTRAL_CAPTURE_POLICY) {
    if (packets.some(({ packet }) => packet.operation === 'spectral-capture')) fail('effect-spectral-evidence-policy', 'Window acknowledgments require their published evidence policy.');
    return { strict: false, nodes, events: [], evidence: 'replayed-analysis-requests;original-window-readiness-and-capture-receipts-not-reconstructed' };
  }
  if (!nodes.size) fail('effect-spectral-evidence-policy', 'The published spectral policy has no prepared spectral source.');
  if (sampleRate !== publication.sampleRate) fail('effect-spectral-window-rate', 'Exact captured analysis windows require their original sample rate. Choose an explicit static revoice for a new window duration.');
  const events = [];
  for (const [nodeId, node] of nodes) {
    const controls = packets.filter(({ packet }) => packet.operation === 'control' && packet.nodeId === nodeId).sort((a, b) => a.packet.targetFrame - b.packet.targetFrame || a.packet.sequence - b.packet.sequence);
    const frames = new Map();
    for (const item of controls) {
      if (Object.keys(item.packet.values).length !== 1 || ![0, 1].includes(item.packet.values.hold01)) fail('effect-spectral-control-domain', 'A spectral source needs discrete hold/thaw controls.');
      frames.set(item.packet.targetFrame, item);
    }
    const episodes = []; let held = false, episode = null;
    for (const item of frames.values()) {
      const next = item.packet.values.hold01 === 1; if (held === next) continue; held = next;
      if (next) { episode = { frame: item.packet.targetFrame, stop: Infinity, captured: false }; episodes.push(episode); }
      else { if (episode) episode.stop = item.packet.targetFrame; events.push({ frame: item.projected.frame, nodeId, values: { hold01: 0 }, sequence: item.packet.sequence, sourceEventIds: item.packet.sourceEventIds }); }
    }
    let serial = 0, lastEnd = -1, episodeIndex = 0;
    for (const { packet, projected } of packets.filter(item => item.packet.operation === 'spectral-capture' && item.packet.nodeId === nodeId).sort((a, b) => a.packet.spectralCapture.serial - b.packet.spectralCapture.serial)) {
      const capture = validateSpectralCaptureReceipt(packet.spectralCapture, node.spectral);
      if (packet.executionEpoch !== publication.executionEpoch || projected.origin !== frameOrigin || packet.sampleRate !== sampleRate || capture.serial !== ++serial || capture.endFrame <= lastEnd) fail('effect-spectral-window-history', 'Spectral windows mix clock owners or omit/duplicate a capture serial.'); lastEnd = capture.endFrame;
      while (episodeIndex < episodes.length && episodes[episodeIndex].stop <= capture.requestFrame) episodeIndex++;
      const source = episodes[episodeIndex];
      if (!source || source.captured || capture.requestFrame < source.frame || capture.endFrame > source.stop) fail('effect-spectral-window-request', 'An acknowledged window has no matching actual held interval.'); source.captured = true; episodeIndex++;
      const start = capture.startFrame - frameOrigin, end = capture.endFrame - frameOrigin;
      if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(end) || end < 1 || projected.frame !== end) fail('effect-spectral-window-before-range', 'The original analysis window precedes this covered source range. Its missing input is not invented.');
      events.push({ kind: 'spectral-capture', frame: end - 1, nodeId, sequence: packet.sequence, sourceEventIds: packet.sourceEventIds, capture });
    }
    for (const item of episodes) if (!item.captured && item.stop >= (Math.floor(item.frame / node.spectral.hopFrames) + 1) * node.spectral.hopFrames) fail('effect-spectral-window-missing', 'A held interval has no complete processor-window acknowledgment. Choose a complete covered range or explicit static revoice.');
  }
  if (packets.some(({ packet }) => packet.operation === 'spectral-capture' && !nodes.has(packet.nodeId))) fail('effect-spectral-window-node', 'A spectral acknowledgment names another graph node.');
  return { strict: true, nodes, events, evidence: 'original-processor-acknowledged-window-intervals;new-input-analysis-at-same-rate-and-grid;not-original-live-PCM-or-spectral-state' };
}
