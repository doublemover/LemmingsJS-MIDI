import { BaseLogger } from '../../util/LogHandler.js';
import { EventHandler } from '../../util/EventHandler.js';
import { scaleImage } from '../../xbrz/xbrz.js';
import { hqxScale, initHqx } from '../../vendor/hqx/index.js';

initHqx();
const cyrb53 = (str, seed = 0) => {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for(let i = 0, ch; i < str.length; i++) {
    ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1  = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2  = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);

  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
};
const scaledFrameCache = new WeakMap();
const frameOpaqueCache = new WeakMap();
const MAX_SCALED_VARIANTS_PER_FRAME = 8;
const marchingAntPerimeterCache = new Map();
const marchingAntPatternCache = new Map();
const MAX_MARCHING_ANT_CACHE_ENTRIES = 256;
const MAX_MARCHING_ANT_PATTERN_CACHE_ENTRIES = 1024;
const MAX_MARCHING_ANT_FAST_PERIMETER = 2048;
const MAX_NEAREST_COORD_CACHE_ENTRIES = 256;
const DIRTY_RECT_MERGE_PAD = 1;
const DIRTY_RECT_FULL_LIMIT = 96;
const DIRTY_TILE_FULL_LIMIT = 1024;
const EMPTY_DIRTY_RECTS = Object.freeze([]);
const nearestCoordinateCache = new Map();
const toUint32Source = (source) => {
  if (source instanceof Uint32Array) return source;
  if (source instanceof Uint8ClampedArray || source instanceof Uint8Array) {
    return new Uint32Array(source.buffer, source.byteOffset, source.byteLength >>> 2);
  }
  return null;
};
const getMarchingAntPerimeterOffsets = (stride, width, height) => {
  const key = `${stride}:${width}:${height}`;
  const cached = marchingAntPerimeterCache.get(key);
  if (cached) return cached;

  const total = (width + 1) + height + width + Math.max(0, height - 1);
  const offsets = new Int32Array(total);
  let i = 0;

  for (let dx = 0; dx <= width; dx += 1) {
    offsets[i++] = dx;
  }
  for (let dy = 1; dy <= height; dy += 1) {
    offsets[i++] = (dy * stride) + width;
  }
  for (let dx = 1; dx <= width; dx += 1) {
    offsets[i++] = (height * stride) + width - dx;
  }
  for (let dy = 1; dy < height; dy += 1) {
    offsets[i++] = ((height - dy) * stride);
  }

  if (marchingAntPerimeterCache.size >= MAX_MARCHING_ANT_CACHE_ENTRIES) {
    marchingAntPerimeterCache.clear();
  }
  marchingAntPerimeterCache.set(key, offsets);
  return offsets;
};
const getMarchingAntPaintPattern = (perimeterLen, dashLen, offset) => {
  const pattern = dashLen * 2;
  const phase = ((offset % pattern) + pattern) % pattern;
  const key = `${perimeterLen}:${dashLen}:${phase}`;
  const cached = marchingAntPatternCache.get(key);
  if (cached) return cached;

  const first = [];
  const second = [];
  for (let i = 0; i < perimeterLen; i += 1) {
    const pos = (phase + i) % pattern;
    if (pos < dashLen) first.push(i);
    else second.push(i);
  }

  const result = {
    first: Int32Array.from(first),
    second: Int32Array.from(second)
  };

  if (marchingAntPatternCache.size >= MAX_MARCHING_ANT_PATTERN_CACHE_ENTRIES) {
    marchingAntPatternCache.clear();
  }
  marchingAntPatternCache.set(key, result);
  return result;
};
const isFrameFullyOpaque = (frame) => {
  if (!frame) return false;
  const version = Number.isFinite(frame._version) ? frame._version : 0;
  const cached = frameOpaqueCache.get(frame);
  if (cached && cached.version === version) {
    return cached.opaque === true;
  }
  const mask = frame.getMask();
  let opaque = true;
  for (let i = 0; i < mask.length; i += 1) {
    if (!mask[i]) {
      opaque = false;
      break;
    }
  }
  frameOpaqueCache.set(frame, { version, opaque });
  return opaque;
};
function getScaledFrameVariant(frame, dstWidth, dstHeight, mode) {
  if (!frame) return null;
  const srcW = frame.width | 0;
  const srcH = frame.height | 0;
  if (!srcW || !srcH || !dstWidth || !dstHeight) return null;
  const scale = Math.round(dstWidth / srcW);
  if (scale < 2 || scale > 4 || dstWidth !== srcW * scale || dstHeight !== srcH * scale) {
    return null;
  }

  const version = Number.isFinite(frame._version) ? frame._version : 0;
  const key = `${mode}:${dstWidth}x${dstHeight}:v${version}`;
  let variants = scaledFrameCache.get(frame);
  if (!variants) {
    variants = new Map();
    scaledFrameCache.set(frame, variants);
  } else if (variants.has(key)) {
    const cached = variants.get(key);
    // True LRU: reads promote the entry so hot scale variants stay resident.
    variants.delete(key);
    variants.set(key, cached);
    return cached;
  }

  const srcBuf = frame.getBuffer();
  const srcMask = frame.getMask();
  const maskLen = srcMask.length;
  const opaqueSrc = new Uint32Array(maskLen);
  for (let i = 0; i < maskLen; i++) {
    opaqueSrc[i] = srcMask[i] ? srcBuf[i] : 0;
  }

  const scaledMask = new Uint8Array(dstWidth * dstHeight);
  for (let dy = 0; dy < dstHeight; dy++) {
    const sy = Math.floor(dy / scale);
    const srcRow = sy * srcW;
    const dstRow = dy * dstWidth;
    for (let dx = 0; dx < dstWidth; dx++) {
      const sx = Math.floor(dx / scale);
      scaledMask[dstRow + dx] = srcMask[srcRow + sx];
    }
  }

  const scaled = mode === 'hqx'
    ? hqxScale(opaqueSrc, srcW, srcH, scale)
    : (() => {
      const out = new Uint32Array(dstWidth * dstHeight);
      scaleImage(scale, opaqueSrc, out, srcW, srcH, 0, srcH);
      return out;
    })();

  const variant = { scaled, scaledMask };
  if (!variants.has(key) && variants.size >= MAX_SCALED_VARIANTS_PER_FRAME) {
    const firstKey = variants.keys().next().value;
    variants.delete(firstKey);
  }
  variants.set(key, variant);
  return variant;
}
function getNearestCoordinateMap(srcLength, dstLength) {
  if (!Number.isFinite(srcLength) || !Number.isFinite(dstLength)) return null;
  const src = Math.trunc(srcLength);
  const dst = Math.trunc(dstLength);
  if (src < 1 || dst < 1) return null;
  const key = `${src}:${dst}`;
  const cached = nearestCoordinateCache.get(key);
  if (cached) {
    nearestCoordinateCache.delete(key);
    nearestCoordinateCache.set(key, cached);
    return cached;
  }

  const ratio = src / dst;
  const map = new Int32Array(dst);
  for (let i = 0; i < dst; i += 1) {
    map[i] = Math.floor(i * ratio);
  }

  if (nearestCoordinateCache.size >= MAX_NEAREST_COORD_CACHE_ENTRIES) {
    const oldestKey = nearestCoordinateCache.keys().next().value;
    nearestCoordinateCache.delete(oldestKey);
  }
  nearestCoordinateCache.set(key, map);
  return map;
}
function getClippedDestinationSpan(destW, destH, baseX, baseY, width, height) {
  const x1 = Math.max(0, -baseX);
  const y1 = Math.max(0, -baseY);
  const x2 = Math.min(width, destW - baseX);
  const y2 = Math.min(height, destH - baseY);
  if (x2 <= x1 || y2 <= y1) return null;
  return { x1, y1, x2, y2 };
}
function scaleNearest(
  frame,
  dstWidth,
  dstHeight,
  opts = {}
) {
  const {
    dest32,
    destW,
    destH,
    baseX,
    baseY,
    nullColor32 = null,
    checkGround = false,
    onlyOverwrite = false,
    noOverwrite = false,
    upsideDown = false,
    groundMask = null
  } = opts;

  if (!dest32) return;

  const { width: srcW, height: srcH } = frame;
  const srcBuf = frame.getBuffer();
  const srcMask = frame.getMask();
  const xMap = getNearestCoordinateMap(srcW, dstWidth);
  const yMap = getNearestCoordinateMap(srcH, dstHeight);
  if (!xMap || !yMap) return;
  const span = getClippedDestinationSpan(destW, destH, baseX, baseY, dstWidth, dstHeight);
  if (!span) return;

  const { x1, y1, x2, y2 } = span;
  for (let dy = y1; dy < y2; dy += 1) {
    const mapY = upsideDown ? (dstHeight - 1 - dy) : dy;
    const srcRowBase = yMap[mapY] * srcW;
    const outY = dy + baseY;
    let destIdx = (outY * destW) + baseX + x1;
    let outX = baseX + x1;

    for (let dx = x1; dx < x2; dx += 1, destIdx += 1, outX += 1) {
      const srcIdx = srcRowBase + xMap[dx];
      if (!srcMask[srcIdx]) {
        if (nullColor32 !== null) dest32[destIdx] = nullColor32;
        continue;
      }

      if (checkGround) {
        const hasGround = groundMask?.hasGroundAt(outX, outY);
        if (noOverwrite && hasGround) continue;
        if (onlyOverwrite && !hasGround) continue;
      }

      dest32[destIdx] = srcBuf[srcIdx];
    }
  }
}
function scaleXbrz(
  frame,
  dstWidth,
  dstHeight,
  opts = {}
) {
  const {
    dest32,
    destW,
    destH,
    baseX,
    baseY,
    nullColor32 = null,
    checkGround = false,
    onlyOverwrite = false,
    noOverwrite = false,
    upsideDown = false,
    groundMask = null
  } = opts;

  if (!dest32) return;

  const { width: srcW, height: srcH } = frame;
  const scale = Math.round(dstWidth / srcW);
  if (scale < 2 || scale > 4 || dstWidth !== srcW * scale || dstHeight !== srcH * scale) {
    scaleNearest(frame, dstWidth, dstHeight, opts);
    return;
  }

  const variant = getScaledFrameVariant(frame, dstWidth, dstHeight, 'xbrz');
  if (!variant) {
    scaleNearest(frame, dstWidth, dstHeight, opts);
    return;
  }
  const { scaled, scaledMask } = variant;
  const span = getClippedDestinationSpan(destW, destH, baseX, baseY, dstWidth, dstHeight);
  if (!span) return;
  const { x1, y1, x2, y2 } = span;
  for (let dy = y1; dy < y2; dy += 1) {
    const srcY = upsideDown ? (dstHeight - 1 - dy) : dy;
    let srcIdx = (srcY * dstWidth) + x1;
    const outY = dy + baseY;
    let destIdx = (outY * destW) + baseX + x1;
    let outX = baseX + x1;
    for (let dx = x1; dx < x2; dx += 1, srcIdx += 1, destIdx += 1, outX += 1) {
      if (!scaledMask[srcIdx]) {
        if (nullColor32 !== null) dest32[destIdx] = nullColor32;
        continue;
      }

      if (checkGround) {
        const hasGround = groundMask?.hasGroundAt(outX, outY);
        if (noOverwrite && hasGround) continue;
        if (onlyOverwrite && !hasGround) continue;
      }

      dest32[destIdx] = scaled[srcIdx];
    }
  }
}
function scaleHqx(
  frame,
  dstWidth,
  dstHeight,
  opts = {}
) {
  const {
    dest32,
    destW,
    destH,
    baseX,
    baseY,
    nullColor32 = null,
    checkGround = false,
    onlyOverwrite = false,
    noOverwrite = false,
    upsideDown = false,
    groundMask = null
  } = opts;

  if (!dest32) return;

  const { width: srcW, height: srcH } = frame;
  const scale = Math.round(dstWidth / srcW);
  if (scale < 2 || scale > 4 || dstWidth !== srcW * scale || dstHeight !== srcH * scale) {
    scaleNearest(frame, dstWidth, dstHeight, opts);
    return;
  }

  const variant = getScaledFrameVariant(frame, dstWidth, dstHeight, 'hqx');
  if (!variant) {
    scaleNearest(frame, dstWidth, dstHeight, opts);
    return;
  }
  const { scaled, scaledMask } = variant;
  const span = getClippedDestinationSpan(destW, destH, baseX, baseY, dstWidth, dstHeight);
  if (!span) return;
  const { x1, y1, x2, y2 } = span;
  for (let dy = y1; dy < y2; dy += 1) {
    const srcY = upsideDown ? (dstHeight - 1 - dy) : dy;
    let srcIdx = (srcY * dstWidth) + x1;
    const outY = dy + baseY;
    let destIdx = (outY * destW) + baseX + x1;
    let outX = baseX + x1;
    for (let dx = x1; dx < x2; dx += 1, srcIdx += 1, destIdx += 1, outX += 1) {
      if (!scaledMask[srcIdx]) {
        if (nullColor32 !== null) dest32[destIdx] = nullColor32;
        continue;
      }

      if (checkGround) {
        const hasGround = groundMask?.hasGroundAt(outX, outY);
        if (noOverwrite && hasGround) continue;
        if (onlyOverwrite && !hasGround) continue;
      }

      dest32[destIdx] = scaled[srcIdx];
    }
  }
}
function drawMarchingAntRect(
  display,
  x,
  y,
  width,
  height,
  dashLen = 3,
  offset = 0,
  color1 = 0xFFFFFFFF,
  color2 = 0xFF000000
) {
  if (!display?.buffer32) return;
  x = Math.trunc(x);
  y = Math.trunc(y);
  width = Math.trunc(width);
  height = Math.trunc(height);
  if (width < 0 || height < 0) return;
  if (dashLen <= 0) dashLen = 1;
  const { width: w, height: h } = display.imgData;
  if (!w || !h) return;
  const buffer32 = display.buffer32;
  const pattern = dashLen * 2;
  const writeColor1 = (color1 >>> 24) !== 0;
  const writeColor2 = (color2 >>> 24) !== 0;
  if (!writeColor1 && !writeColor2) return;
  const perimeter = (width + 1) + height + width + Math.max(0, height - 1);
  const x2 = x + width;
  const y2 = y + height;
  const fullyInBounds = x >= 0 && y >= 0 && x2 < w && y2 < h;

  if (fullyInBounds && perimeter <= MAX_MARCHING_ANT_FAST_PERIMETER) {
    const baseIndex = (y * w) + x;
    const offsets = getMarchingAntPerimeterOffsets(w, width, height);
    const paintPattern = getMarchingAntPaintPattern(offsets.length, dashLen, offset);
    if (writeColor1) {
      const first = paintPattern.first;
      for (let i = 0; i < first.length; i += 1) {
        buffer32[baseIndex + offsets[first[i]]] = color1;
      }
    }
    if (writeColor2) {
      const second = paintPattern.second;
      for (let i = 0; i < second.length; i += 1) {
        buffer32[baseIndex + offsets[second[i]]] = color2;
      }
    }
    return;
  }

  let pos = ((offset % pattern) + pattern) % pattern;
  const writeAtIndex = (idx) => {
    if (writeColor1 && writeColor2) {
      buffer32[idx] = pos < dashLen ? color1 : color2;
      return;
    }
    if (writeColor1) {
      if (pos < dashLen) buffer32[idx] = color1;
      return;
    }
    if (pos >= dashLen) {
      buffer32[idx] = color2;
    }
  };
  const advancePattern = () => {
    pos += 1;
    if (pos === pattern) pos = 0;
  };

  if (fullyInBounds) {
    let idx = y * w + x;
    for (let dx = 0; dx <= width; dx += 1, idx += 1) {
      writeAtIndex(idx);
      advancePattern();
    }
    idx = (y + 1) * w + x + width;
    for (let dy = 1; dy <= height; dy += 1, idx += w) {
      writeAtIndex(idx);
      advancePattern();
    }
    idx = (y + height) * w + x + width - 1;
    for (let dx = 1; dx <= width; dx += 1, idx -= 1) {
      writeAtIndex(idx);
      advancePattern();
    }
    idx = (y + height - 1) * w + x;
    for (let dy = 1; dy < height; dy += 1, idx -= w) {
      writeAtIndex(idx);
      advancePattern();
    }
    return;
  }

  for (let dx = 0; dx <= width; dx += 1) {
    const xx = x + dx;
    if (y >= 0 && y < h && xx >= 0 && xx < w) {
      writeAtIndex((y * w) + xx);
    }
    advancePattern();
  }
  for (let dy = 1; dy <= height; dy += 1) {
    const yy = y + dy;
    if (yy >= 0 && yy < h && x2 >= 0 && x2 < w) {
      writeAtIndex((yy * w) + x2);
    }
    advancePattern();
  }
  for (let dx = 1; dx <= width; dx += 1) {
    const xx = x2 - dx;
    if (y2 >= 0 && y2 < h && xx >= 0 && xx < w) {
      writeAtIndex((y2 * w) + xx);
    }
    advancePattern();
  }
  for (let dy = 1; dy < height; dy += 1) {
    const yy = y2 - dy;
    if (yy >= 0 && yy < h && x >= 0 && x < w) {
      writeAtIndex((yy * w) + x);
    }
    advancePattern();
  }
}
function drawDashedRect(
  display,
  x,
  y,
  width,
  height,
  dashLen = 3,
  offset = 0,
  color1 = 0xFFFFFFFF,
  color2 = 0xFF000000
) {
  drawMarchingAntRect(
    display,
    x,
    y,
    width,
    height,
    dashLen,
    offset,
    color1,
    color2
  );
}
const __test__ = {
  cyrb53,
  getScaledFrameVariant,
  getNearestCoordinateMap,
  _scaledFrameCache: scaledFrameCache,
  _nearestCoordinateCache: nearestCoordinateCache,
  _marchingAntPerimeterCache: marchingAntPerimeterCache,
  _marchingAntPatternCache: marchingAntPatternCache,
  getMarchingAntPerimeterOffsets,
  getMarchingAntPaintPattern
};

export {
  BaseLogger,
  DIRTY_RECT_FULL_LIMIT,
  DIRTY_RECT_MERGE_PAD,
  DIRTY_TILE_FULL_LIMIT,
  EMPTY_DIRTY_RECTS,
  EventHandler,
  MAX_MARCHING_ANT_CACHE_ENTRIES,
  MAX_MARCHING_ANT_FAST_PERIMETER,
  MAX_MARCHING_ANT_PATTERN_CACHE_ENTRIES,
  MAX_NEAREST_COORD_CACHE_ENTRIES,
  MAX_SCALED_VARIANTS_PER_FRAME,
  __test__,
  cyrb53,
  drawDashedRect,
  drawMarchingAntRect,
  frameOpaqueCache,
  getClippedDestinationSpan,
  getMarchingAntPaintPattern,
  getMarchingAntPerimeterOffsets,
  getNearestCoordinateMap,
  getScaledFrameVariant,
  hqxScale,
  initHqx,
  isFrameFullyOpaque,
  marchingAntPatternCache,
  marchingAntPerimeterCache,
  nearestCoordinateCache,
  scaleHqx,
  scaleImage,
  scaleNearest,
  scaleXbrz,
  scaledFrameCache,
  toUint32Source
};
