// @ts-check
const DEFAULT_OPTIONS = Object.freeze({
  keyframeInterval: 120,
  preserveFutureHistory: false,
  enableHistoryCap: true,
  historyCapTicks: 20000,
  historyWarnTicks: 15000,
  deltaPoolLimit: 64,
  deltaBlockSizeTicks: 256,
  coldBlockAgeTicks: 2048,
  coldCompactionIntervalTicks: 1,
  coldCompactionMaxBlocksPerSweep: 4,
  enableColdBlockCompression: true,
  enableColdBlockDedupe: true
});

const COLD_DELTA_SENTINEL = 1;
const DELTA_FLAG_LEMMING_ADDS = 1 << 0;
const DELTA_FLAG_LEMMING_CHANGES = 1 << 1;
const DELTA_FLAG_LEMMING_REMOVALS = 1 << 2;
const DELTA_FLAG_LEMMING_MANAGER = 1 << 3;
const DELTA_FLAG_GROUND = 1 << 4;
const DELTA_FLAG_ENTRANCE = 1 << 5;
const DELTA_FLAG_TRIGGERS = 1 << 6;
const DELTA_FLAG_OBJECTS = 1 << 7;
const DELTA_FLAG_SCALARS = 1 << 8;
const DELTA_FLAG_SOUND_EVENTS = 1 << 9;
const DELTA_FLAG_MINIMAP_DEATHS = 1 << 10;
const DELTA_FLAG_LEMMING_MUTATIONS =
  DELTA_FLAG_LEMMING_ADDS |
  DELTA_FLAG_LEMMING_CHANGES |
  DELTA_FLAG_LEMMING_REMOVALS;

const COLD_BLOCK_MAGIC = 0x42534c48; // 'HLSB'
const COLD_BLOCK_VERSION = 1;
const DELTA_CODEC_VERSION = 1;
const NULL_INT32 = -2147483648;
const textEncoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
const textDecoder = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;

const toNonNegativeInt = (value, fallback) => {
  if (!Number.isFinite(value)) return fallback;
  const next = Math.trunc(value);
  return next >= 0 ? next : fallback;
};

const encodeText = (value) => {
  if (textEncoder) return textEncoder.encode(value);
  const bytes = [];
  for (let i = 0; i < value.length; i += 1) {
    bytes.push(value.charCodeAt(i) & 0xff);
  }
  return Uint8Array.from(bytes);
};

const decodeText = (bytes) => {
  if (textDecoder) return textDecoder.decode(bytes);
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
};

const toI32 = (value, fallback = 0) => {
  if (!Number.isFinite(value)) return fallback;
  return Math.trunc(value);
};

const toU8 = (value, fallback = 0) => {
  if (!Number.isFinite(value)) return fallback;
  const int = Math.trunc(value);
  if (int <= 0) return 0;
  if (int >= 255) return 255;
  return int;
};

const toBoolByte = (value) => (value ? 1 : 0);

const normalizeOptions = (options = {}) => {
  const keyframeInterval = Math.max(1, toNonNegativeInt(options.keyframeInterval, DEFAULT_OPTIONS.keyframeInterval));
  const deltaPoolLimit = toNonNegativeInt(options.deltaPoolLimit, DEFAULT_OPTIONS.deltaPoolLimit);
  const historyCapTicks = toNonNegativeInt(options.historyCapTicks, DEFAULT_OPTIONS.historyCapTicks);
  const deltaBlockSizeTicks = Math.max(1, toNonNegativeInt(options.deltaBlockSizeTicks, DEFAULT_OPTIONS.deltaBlockSizeTicks));
  const coldBlockAgeTicks = Math.max(0, toNonNegativeInt(options.coldBlockAgeTicks, DEFAULT_OPTIONS.coldBlockAgeTicks));
  const coldCompactionIntervalTicks = Math.max(1, toNonNegativeInt(
    options.coldCompactionIntervalTicks,
    DEFAULT_OPTIONS.coldCompactionIntervalTicks
  ));
  const coldCompactionMaxBlocksPerSweep = Math.max(1, toNonNegativeInt(
    options.coldCompactionMaxBlocksPerSweep,
    DEFAULT_OPTIONS.coldCompactionMaxBlocksPerSweep
  ));
  let historyWarnTicks = toNonNegativeInt(options.historyWarnTicks, DEFAULT_OPTIONS.historyWarnTicks);
  if (historyCapTicks > 0 && historyWarnTicks > historyCapTicks) {
    historyWarnTicks = historyCapTicks;
  }
  return {
    keyframeInterval,
    preserveFutureHistory: !!options.preserveFutureHistory,
    enableHistoryCap: options.enableHistoryCap !== false,
    historyCapTicks,
    historyWarnTicks,
    deltaPoolLimit,
    deltaBlockSizeTicks,
    coldBlockAgeTicks,
    coldCompactionIntervalTicks,
    coldCompactionMaxBlocksPerSweep,
    enableColdBlockCompression: options.enableColdBlockCompression !== false,
    enableColdBlockDedupe: options.enableColdBlockDedupe !== false
  };
};

export {
  DEFAULT_OPTIONS,
  COLD_DELTA_SENTINEL,
  DELTA_FLAG_LEMMING_ADDS,
  DELTA_FLAG_LEMMING_CHANGES,
  DELTA_FLAG_LEMMING_REMOVALS,
  DELTA_FLAG_LEMMING_MANAGER,
  DELTA_FLAG_GROUND,
  DELTA_FLAG_ENTRANCE,
  DELTA_FLAG_TRIGGERS,
  DELTA_FLAG_OBJECTS,
  DELTA_FLAG_SCALARS,
  DELTA_FLAG_SOUND_EVENTS,
  DELTA_FLAG_MINIMAP_DEATHS,
  DELTA_FLAG_LEMMING_MUTATIONS,
  COLD_BLOCK_MAGIC,
  COLD_BLOCK_VERSION,
  DELTA_CODEC_VERSION,
  NULL_INT32,
  encodeText,
  decodeText,
  toI32,
  toU8,
  toBoolByte,
  normalizeOptions
};
