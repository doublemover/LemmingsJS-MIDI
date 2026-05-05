const formatDebugBytes = (bytes) => {
  if (!Array.isArray(bytes) || !bytes.length) return '--';
  return bytes
    .map(value => Number(value).toString(16).padStart(2, '0'))
    .join(' ');
};

const formatDebugOutput = (payload) => {
  if (!payload) return '--';
  if (Array.isArray(payload)) return formatDebugBytes(payload);
  if (typeof payload === 'object') {
    const note = Number.isFinite(payload.note) ? payload.note : '?';
    const velocity = Number.isFinite(payload.velocity) ? payload.velocity : '?';
    const channel = Number.isFinite(payload.channel) ? payload.channel : '?';
    return `note ${note} vel ${velocity} ch ${channel}`;
  }
  return String(payload);
};

export {
  formatDebugBytes,
  formatDebugOutput
};
