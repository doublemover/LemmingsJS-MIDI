export function parseSmf(bytes) {
  const events = []; let offset = 22, tick = 0;
  const read = () => bytes[offset++];
  const variable = () => { let value = 0, part; do { part = read(); value = value * 128 + (part & 127); } while (part & 128); return value; };
  while (offset < bytes.length) {
    tick += variable(); const status = read();
    if (status === 0xff) {
      const type = read(), size = variable(), data = Array.from(bytes.slice(offset, offset + size)); offset += size;
      events.push({ tick, status, type, data });
    } else {
      const size = (status & 0xf0) === 0xc0 || (status & 0xf0) === 0xd0 ? 1 : 2;
      const data = Array.from(bytes.slice(offset, offset + size)); offset += size; events.push({ tick, status, data });
    }
  }
  return events;
}
