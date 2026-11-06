import { PROPERTY_LIMITS, parsePropertyJson } from './PropertyDataCodec.js';

export function createPropertyChunkTransfer() {
  const parts = []; let next = 1, total = null, header = null, size = 0, done = false;
  return Object.freeze({
    accept(message) {
      if (done || !Number.isInteger(message.chunkNumber) || !Number.isInteger(message.totalChunks) || message.totalChunks < 0 || message.totalChunks > PROPERTY_LIMITS.chunks ||
          !Array.isArray(message.headerData) || !Array.isArray(message.propertyData) || message.headerData.length > PROPERTY_LIMITS.headerBytes) throw new Error('Malformed or retired Property Exchange transfer');
      if (message.chunkNumber === 0) throw new Error('Responder marked the property data incomplete');
      if (message.chunkNumber !== next || next > PROPERTY_LIMITS.chunks || message.totalChunks && message.totalChunks < next ||
          total != null && message.totalChunks !== total && message.totalChunks !== next) throw new Error('Out-of-order or inconsistent property chunks');
      if (next === 1) {
        const parsed = parsePropertyJson(message.headerData, PROPERTY_LIMITS.headerBytes).value;
        if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object' || Object.values(parsed).some(value => value && typeof value === 'object')) throw new Error('Property header must contain simple fields');
        header = parsed;
      } else if (message.headerData.length) throw new Error('Repeated property header');
      if (message.totalChunks) total = message.totalChunks;
      size += message.propertyData.length; if (size > PROPERTY_LIMITS.wireBytes || message.propertyData.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 127)) throw new Error('Property wire byte capacity or invalid data');
      parts.push(Uint8Array.from(message.propertyData)); next++; done = total === message.chunkNumber;
      if (!done) return Object.freeze({ done: false, header, size, chunkNumber: message.chunkNumber });
      const bytes = new Uint8Array(size); let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length; } parts.length = 0;
      return Object.freeze({ done: true, header, bytes, size, chunkNumber: message.chunkNumber });
    },
    state: () => Object.freeze({ next, total, size, done }),
    clear() { parts.length = 0; size = 0; done = true; }
  });
}
