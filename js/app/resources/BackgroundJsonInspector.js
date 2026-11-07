export const backgroundJobError = (code, message) => Object.assign(new Error(message), { code, name: 'BackgroundJobError' });
export const checkBackgroundJob = (signal, current) => { signal?.throwIfAborted(); if (current && !current()) throw backgroundJobError('stale-owner', 'Background job source ownership changed.'); };
export const encodedLength = text => {
  let bytes = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 128) bytes++;
    else if (code < 2048) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && text.charCodeAt(index + 1) >= 0xdc00 && text.charCodeAt(index + 1) <= 0xdfff) { bytes += 4; index++; }
    else bytes += 3;
  }
  return bytes;
};
export const inspectText = async (text, { maxBytes, maxNodes, estimatedPeakBytes, signal, current, onProgress, yieldControl }) => {
  if (typeof text !== 'string' || text.length > maxBytes) throw backgroundJobError('input-capacity', 'JSON input exceeds the admitted byte bound.');
  let depth = 0, quoted = false, escaped = false, token = true, nodes = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; }
    else if (char === '"') { quoted = true; token = false; nodes++; }
    else if (char === '{' || char === '[') { if (++depth > 48) throw backgroundJobError('structure-capacity', 'JSON exceeds the supported nesting depth.'); token = true; nodes++; }
    else if (char === '}' || char === ']') { depth--; token = false; }
    else if (char === ':' || char === ',') token = true;
    else if (char !== ' ' && char !== '\n' && char !== '\t' && char !== '\r' && token) { token = false; nodes++; }
    if (nodes > maxNodes || text.length * 8 + nodes * 32 > estimatedPeakBytes) throw backgroundJobError('memory-capacity', 'JSON structure exceeds its admitted memory estimate.');
    if ((index & 65535) === 65535) { checkBackgroundJob(signal, current); onProgress({ phase: 'validating-json', completedUnits: index + 1, totalUnits: text.length }); await yieldControl(); }
  }
  checkBackgroundJob(signal, current);
  const bytes = encodedLength(text); if (bytes > maxBytes) throw backgroundJobError('input-capacity', 'JSON UTF-8 input exceeds the admitted byte bound.');
  return { bytes, nodes };
};
