import { decodeUmpPacket } from './UmpPacketCodec.js';
const failure = (code, message) => Object.assign(new Error(message), { name: 'UmpPayloadError', code });

export function createUmpPayloadCollector({ maximumStreams = 32, maximumMessageBytes = 65536, maximumTotalBytes = 1048576, maximumPackets = 8192, timeoutMs = 5000, now = () => performance.now() } = {}) {
  if (![maximumStreams, maximumMessageBytes, maximumTotalBytes, maximumPackets, timeoutMs].every(value => Number.isSafeInteger(value) && value > 0) || maximumStreams > 256 || maximumMessageBytes > 1048576 || maximumTotalBytes > 8 * 1048576 || maximumPackets > 65536 || timeoutMs > 60000) throw new RangeError('Invalid UMP payload bounds.');
  const streams = new Map(); let totalBytes = 0, expired = 0, lastTime = -Infinity;
  const remove = key => { const prior = streams.get(key); if (prior) { totalBytes -= prior.bytes; streams.delete(key); } };
  const expire = at => { for (const [key, stream] of streams) if (at - stream.startedAt > timeoutMs) { remove(key); expired++; } };
  const layout = packet => {
    if (!packet?.known || !packet.dispatchable || !Array.isArray(packet.payload)) throw failure('unsupported-payload', 'Payload collection requires a validated known packet.');
    if (packet.kind === 'sysex7') return { key: `sysex7:${packet.group}`, payload: packet.payload, identity: { kind: packet.kind, group: packet.group } };
    if (packet.kind === 'sysex8') return { key: `sysex8:${packet.group}:${packet.streamId}`, payload: packet.payload, identity: { kind: packet.kind, group: packet.group, streamId: packet.streamId } };
    if (packet.kind === 'flex-data' && [1, 2].includes(packet.bank)) return { key: `flex:${packet.group}:${packet.address}:${packet.channel ?? '-'}:${packet.bank}:${packet.status}`, payload: packet.payload, text: true,
      identity: { kind: 'flex-text', group: packet.group, address: packet.address, ...(packet.channel == null ? {} : { channel: packet.channel }), bank: packet.bank, status: packet.status } };
    if (packet.kind === 'stream' && [3, 4, 18].includes(packet.status)) return { key: `stream:${packet.status}:${packet.status === 18 ? packet.payload[0] : '-'}`, payload: packet.status === 18 ? packet.payload.slice(1) : packet.payload, text: true,
      identity: { kind: 'stream-text', status: packet.status, ...(packet.status === 18 ? { functionBlock: packet.payload[0] } : {}) } };
    throw failure('unsupported-payload', 'This UMP packet has no supported multi-packet payload.');
  };
  return Object.freeze({
    accept(packet) {
      packet = decodeUmpPacket(packet?.words);
      const at = now(); if (!Number.isFinite(at) || at < lastTime) throw failure('collector-clock', 'Payload expiry requires monotonic receive time.'); lastTime = at; expire(at);
      const frame = layout(packet), format = packet.format; if (![0, 1, 2, 3].includes(format)) throw failure('payload-format', 'Invalid multipart format.');
      const previous = streams.get(frame.key);
      if ([0, 1].includes(format) ? !!previous : !previous) { remove(frame.key); throw failure('payload-order', 'Unexpected complete/start/continuation/end sequence.'); }
      const stream = previous || { identity: frame.identity, text: !!frame.text, chunks: [], bytes: 0, packets: 0, startedAt: at };
      if (stream.bytes + frame.payload.length > maximumMessageBytes || totalBytes + frame.payload.length > maximumTotalBytes || stream.packets + 1 > maximumPackets || !previous && streams.size >= maximumStreams) { remove(frame.key); throw failure('payload-capacity', 'Multipart UMP data exceeds its admitted collector capacity.'); }
      if (frame.payload.some(byte => !Number.isInteger(byte) || byte < 0 || byte > (packet.kind === 'sysex7' ? 127 : 255))) { remove(frame.key); throw failure('payload-byte', 'Invalid multipart payload byte.'); }
      if (!previous) streams.set(frame.key, stream);
      stream.chunks.push(Uint8Array.from(frame.payload)); stream.bytes += frame.payload.length; stream.packets++; totalBytes += frame.payload.length;
      if (format !== 0 && format !== 3) return Object.freeze({ status: 'partial', bytes: stream.bytes, packets: stream.packets });
      try {
        const payload = new Uint8Array(stream.bytes); let offset = 0; for (const chunk of stream.chunks) { payload.set(chunk, offset); offset += chunk.length; }
        let text;
        if (stream.text) { let end = payload.length; while (end && !payload[end - 1]) end--; if (payload.subarray(0, end).includes(0)) throw failure('text-padding', 'Unexpected embedded UMP text terminator.'); text = new TextDecoder('utf-8', { fatal: true }).decode(payload.subarray(0, end)); }
        return Object.freeze({ status: 'complete', ...stream.identity, payload, ...(stream.text ? { text } : {}), packets: stream.packets });
      } finally { remove(frame.key); }
    },
    reset() { streams.clear(); totalBytes = 0; expired = 0; lastTime = -Infinity; },
    diagnostics() { return Object.freeze({ streams: streams.size, retainedBytes: totalBytes, expired, maximumStreams, maximumMessageBytes, maximumTotalBytes }); }
  });
}
