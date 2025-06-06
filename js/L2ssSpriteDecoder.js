export const PAL_DIFF = 0x10;

function readU16BE(buf, off) {
  return (buf[off] << 8) | buf[off + 1];
}

function readU32BE(buf, off) {
  return (
    (buf[off] << 24) |
    (buf[off + 1] << 16) |
    (buf[off + 2] << 8) |
    buf[off + 3]
  );
}

export function decodeFrame(data, base, index, palette) {
  let off = base;
  const width = readU16BE(data, off);
  off += 2;
  const height = readU16BE(data, off);
  off += 2;
  const pointers = [
    readU32BE(data, off),
    readU32BE(data, off + 4),
    readU32BE(data, off + 8),
    readU32BE(data, off + 12)
  ];
  off += 16;
  const pixels = new Uint8ClampedArray(width * height * 3);
  for (let plane = 0; plane < 4; plane++) {
    let pos = base + pointers[plane];
    let x = plane;
    let y = 0;
    let n = 0;
    let m = 0;
    let l = 0;
    let xAdd = 0;
    let remindM = false;
    let remindL = false;
    let remindL2 = false;
    while (true) {
      const byte = data[pos++];
      if (byte === 0xff) break;
      if (n || m || l) {
        const idx = (y * width + x) * 3;
        const c = palette[byte - PAL_DIFF] || [0, 0, 0];
        pixels[idx] = c[0];
        pixels[idx + 1] = c[1];
        pixels[idx + 2] = c[2];
        x += 4;
        if (n && --n === 0) {
          y++;
          x = plane;
        }
        if (m && --m === 0 && remindM) {
          x += 4 * xAdd;
          xAdd = 0;
          remindM = false;
        }
        if (l && --l === 0 && remindL) {
          if (remindL2) {
            x += 4 * xAdd;
            xAdd = 0;
          } else {
            y++;
            x = plane;
          }
          remindL = false;
          remindL2 = false;
        }
      } else {
        if (byte === 0x00) {
          y++;
          x = plane;
        } else if (byte > 0x7f) {
          if ((byte & 0xf0) === 0xe0 && (byte & 0xf) > 0x7) {
            x += 4 * (byte & 0xf) - 8;
          } else {
            l = byte & 0xf;
            x += 4 * ((byte >> 4) - 8);
          }
        } else {
          if ((byte & 0xf) === 0) {
            n = byte >> 4;
          } else if ((byte & 0xf) < 8) {
            m = (byte & 0xf) + (byte >> 4);
          } else {
            m = byte >> 4;
            xAdd += (byte & 0xf) - 8;
            remindM = true;
          }
        }
      }
    }
  }
  return { width, height, pixels };
}
