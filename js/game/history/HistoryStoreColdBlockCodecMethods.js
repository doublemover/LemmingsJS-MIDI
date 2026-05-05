// @ts-check
import { SkillTypes } from '../SkillTypes.js';
import { Trigger } from '../../level/Trigger.js';
import {
  COLD_BLOCK_MAGIC,
  COLD_BLOCK_VERSION,
  COLD_DELTA_SENTINEL,
  DEFAULT_OPTIONS,
  DELTA_CODEC_VERSION,
  DELTA_FLAG_ENTRANCE,
  DELTA_FLAG_GROUND,
  DELTA_FLAG_LEMMING_ADDS,
  DELTA_FLAG_LEMMING_CHANGES,
  DELTA_FLAG_LEMMING_MANAGER,
  DELTA_FLAG_LEMMING_MUTATIONS,
  DELTA_FLAG_LEMMING_REMOVALS,
  DELTA_FLAG_MINIMAP_DEATHS,
  DELTA_FLAG_OBJECTS,
  DELTA_FLAG_SCALARS,
  DELTA_FLAG_SOUND_EVENTS,
  DELTA_FLAG_TRIGGERS,
  NULL_INT32,
  normalizeOptions,
  toI32
} from './HistoryShared.js';
import {
  BinaryReader,
  BinaryWriter,
  bytesEqual,
  fnv1aHashBytes,
  readTaggedValue,
  rleDecodeBytes,
  rleEncodeBytes,
  writeTaggedValue
} from './HistoryBinaryCodec.js';
import {
  applyLemmingSnapshot,
  cloneLemmingState,
  createLemmingState,
  ensureLemmingCapacity,
  snapshotLemming
} from './HistoryLemmingState.js';
import {
  computeDeltaFlags,
  createDelta,
  ensureDeltaFlags,
  isNoOpDelta,
  packLemmingChanges,
  packLemmingMutationList,
  packTimerStateForStorage,
  readPackedLemmingChanges,
  readPackedLemmingMutation,
  unpackLemmingChanges,
  unpackLemmingMutationList,
  unpackTimerStateFromStorage,
  writePackedLemmingChanges,
  writePackedLemmingMutation
} from './HistoryDeltaCodec.js';
import {
  MIDI_FLAG_OWNER_KIND,
  clonePlainObject,
  createMidiFlagTriggerOwner
} from './HistoryTriggerOwners.js';

const historyStoreColdBlockCodecMethods = {
  _buildColdBlockPayload(block) {
    const noOpStarts = [];
    const noOpLengths = [];
    const deltaOffsets = [];
    const deltaBytes = [];
    let runStart = -1;
    let runLen = 0;
    for (let tick = block.startTick; tick <= block.endTick; tick += 1) {
      const entry = this.deltas[tick];
      if (!entry || entry === COLD_DELTA_SENTINEL) {
        if (runLen > 0) {
          noOpStarts.push(runStart);
          noOpLengths.push(runLen);
          runStart = -1;
          runLen = 0;
        }
        continue;
      }
      const offset = tick - block.startTick;
      if (isNoOpDelta(entry)) {
        if (runLen === 0) {
          runStart = offset;
          runLen = 1;
        } else if (offset === (runStart + runLen)) {
          runLen += 1;
        } else {
          noOpStarts.push(runStart);
          noOpLengths.push(runLen);
          runStart = offset;
          runLen = 1;
        }
      } else {
        if (runLen > 0) {
          noOpStarts.push(runStart);
          noOpLengths.push(runLen);
          runStart = -1;
          runLen = 0;
        }
        const packed = this._packDeltaForStorage(entry);
        deltaOffsets.push(offset);
        deltaBytes.push(packed);
      }
    }
    if (runLen > 0) {
      noOpStarts.push(runStart);
      noOpLengths.push(runLen);
    }
    return {
      noOpStarts: Uint32Array.from(noOpStarts),
      noOpLengths: Uint32Array.from(noOpLengths),
      deltaOffsets: Uint32Array.from(deltaOffsets),
      deltaBytes
    };
  },

  _encodeColdBlockPayload(payload) {
    const writer = new BinaryWriter();
    writer.writeU32(COLD_BLOCK_MAGIC);
    writer.writeU8(COLD_BLOCK_VERSION);
    const noOpCount = payload?.noOpStarts?.length || 0;
    writer.writeVarUint(noOpCount);
    for (let i = 0; i < noOpCount; i += 1) {
      writer.writeVarUint(payload.noOpStarts[i]);
      writer.writeVarUint(payload.noOpLengths[i]);
    }
    const deltaCount = payload?.deltaOffsets?.length || 0;
    writer.writeVarUint(deltaCount);
    for (let i = 0; i < deltaCount; i += 1) {
      writer.writeVarUint(payload.deltaOffsets[i]);
    }
    for (let i = 0; i < deltaCount; i += 1) {
      const bytes = payload.deltaBytes?.[i] || new Uint8Array(0);
      writer.writeVarUint(bytes.length);
    }
    for (let i = 0; i < deltaCount; i += 1) {
      writer.writeRaw(payload.deltaBytes?.[i] || new Uint8Array(0));
    }
    return writer.toUint8Array();
  },

  _decodeColdBlockPayload(bytes) {
    const reader = new BinaryReader(bytes);
    const magic = reader.readU32();
    if (magic !== COLD_BLOCK_MAGIC) {
      throw new Error('HistoryStore cold-block magic mismatch.');
    }
    const version = reader.readU8();
    if (version !== COLD_BLOCK_VERSION) {
      throw new Error(`HistoryStore cold-block version ${version} is unsupported.`);
    }
  
    const noOpCount = reader.readVarUint();
    const noOpRanges = new Array(noOpCount);
    for (let i = 0; i < noOpCount; i += 1) {
      noOpRanges[i] = [reader.readVarUint(), reader.readVarUint()];
    }
  
    const deltaCount = reader.readVarUint();
    const offsets = new Array(deltaCount);
    const lengths = new Array(deltaCount);
    for (let i = 0; i < deltaCount; i += 1) offsets[i] = reader.readVarUint();
    for (let i = 0; i < deltaCount; i += 1) lengths[i] = reader.readVarUint();
    const deltaEntries = new Array(deltaCount);
    for (let i = 0; i < deltaCount; i += 1) {
      deltaEntries[i] = [offsets[i], reader.readRaw(lengths[i])];
    }
    if (!reader.eof()) {
      throw new Error('HistoryStore cold-block payload has trailing bytes.');
    }
    return { noOpRanges, deltaEntries };
  },

  _decodeColdBlock(block) {
    if (!block?.cold || !block.encodedBytes) return null;
    if (block.decoded) return block.decoded;
    const bytes = block.encoding === 'rle'
      ? rleDecodeBytes(block.encodedBytes)
      : block.encodedBytes;
    const payload = this._decodeColdBlockPayload(bytes);
    const deltaMap = new Map();
    for (const [offset, deltaBytes] of payload.deltaEntries || []) {
      const tick = block.startTick + offset;
      deltaMap.set(offset, this._unpackDeltaFromStorage(deltaBytes, tick));
    }
    block.decoded = {
      noOpRanges: payload.noOpRanges || [],
      deltaMap,
      noOpCache: new Map()
    };
    return block.decoded;
  },

  _packDeltaForStorage(delta) {
    const writer = new BinaryWriter();
    const flags = computeDeltaFlags(delta);
    const tick = toI32(delta?.tick);
    writer.writeU8(DELTA_CODEC_VERSION);
    writer.writeU32(flags);
    if (flags & DELTA_FLAG_LEMMING_CHANGES) {
      writePackedLemmingChanges(writer, packLemmingChanges(delta.lemChanges));
    }
    if (flags & DELTA_FLAG_LEMMING_ADDS) {
      writePackedLemmingMutation(writer, packLemmingMutationList(delta.lemAdded));
    }
    if (flags & DELTA_FLAG_LEMMING_REMOVALS) {
      writePackedLemmingMutation(writer, packLemmingMutationList(delta.lemRemoved));
    }
    if (flags & DELTA_FLAG_LEMMING_MANAGER) {
      writeTaggedValue(writer, delta.lemmingManagerChanges || null);
    }
    if (flags & DELTA_FLAG_GROUND) {
      writeTaggedValue(writer, delta.groundChanges || null);
    }
    if (flags & DELTA_FLAG_ENTRANCE) {
      writeTaggedValue(writer, delta.entranceChanges || null);
    }
    if (flags & DELTA_FLAG_TRIGGERS) {
      writeTaggedValue(writer, {
        triggerCooldownChanges: delta.triggerCooldownChanges || null,
        triggerAdd: delta.triggerAdd || [],
        triggerRemove: delta.triggerRemove || []
      });
    }
    if (flags & DELTA_FLAG_OBJECTS) {
      writeTaggedValue(writer, delta.objectAnimChanges || null);
    }
    if (flags & DELTA_FLAG_SCALARS) {
      writeTaggedValue(writer, {
        victoryChanges: delta.victoryChanges || null,
        skillsChanges: delta.skillsChanges || null,
        timerChanges: delta.timerChanges
          ? {
            prev: packTimerStateForStorage(delta.timerChanges.prev, tick),
            next: packTimerStateForStorage(delta.timerChanges.next, tick)
          }
          : null,
        gameChanges: delta.gameChanges || null
      });
    }
    if (flags & DELTA_FLAG_SOUND_EVENTS) {
      writeTaggedValue(writer, delta.soundEvents || []);
    }
    if (flags & DELTA_FLAG_MINIMAP_DEATHS) {
      writeTaggedValue(writer, delta.minimapDeaths || []);
    }
    return writer.toUint8Array();
  },

  _unpackDeltaFromStorage(packed, tick) {
    const reader = new BinaryReader(packed);
    const version = reader.readU8();
    if (version !== DELTA_CODEC_VERSION) {
      throw new Error(`HistoryStore delta codec version ${version} is unsupported.`);
    }
    const flags = reader.readU32() | 0;
    const delta = createDelta(tick);
    delta.flags = flags;
  
    if (flags & DELTA_FLAG_LEMMING_CHANGES) {
      delta.lemChanges = unpackLemmingChanges(readPackedLemmingChanges(reader));
    }
    if (flags & DELTA_FLAG_LEMMING_ADDS) {
      delta.lemAdded = unpackLemmingMutationList(readPackedLemmingMutation(reader));
    }
    if (flags & DELTA_FLAG_LEMMING_REMOVALS) {
      delta.lemRemoved = unpackLemmingMutationList(readPackedLemmingMutation(reader));
    }
    if (flags & DELTA_FLAG_LEMMING_MANAGER) {
      delta.lemmingManagerChanges = readTaggedValue(reader);
    }
    if (flags & DELTA_FLAG_GROUND) {
      delta.groundChanges = readTaggedValue(reader) || delta.groundChanges;
    }
    if (flags & DELTA_FLAG_ENTRANCE) {
      delta.entranceChanges = readTaggedValue(reader) || delta.entranceChanges;
    }
    if (flags & DELTA_FLAG_TRIGGERS) {
      const triggerPayload = readTaggedValue(reader) || {};
      delta.triggerCooldownChanges = triggerPayload.triggerCooldownChanges || delta.triggerCooldownChanges;
      delta.triggerAdd = triggerPayload.triggerAdd || delta.triggerAdd;
      delta.triggerRemove = triggerPayload.triggerRemove || delta.triggerRemove;
    }
    if (flags & DELTA_FLAG_OBJECTS) {
      delta.objectAnimChanges = readTaggedValue(reader) || delta.objectAnimChanges;
    }
    if (flags & DELTA_FLAG_SCALARS) {
      const scalarPayload = readTaggedValue(reader) || {};
      delta.victoryChanges = scalarPayload.victoryChanges || null;
      delta.skillsChanges = scalarPayload.skillsChanges || null;
      delta.timerChanges = scalarPayload.timerChanges
        ? {
          prev: unpackTimerStateFromStorage(scalarPayload.timerChanges.prev, tick),
          next: unpackTimerStateFromStorage(scalarPayload.timerChanges.next, tick)
        }
        : null;
      delta.gameChanges = scalarPayload.gameChanges || null;
    }
    if (flags & DELTA_FLAG_SOUND_EVENTS) {
      delta.soundEvents = readTaggedValue(reader) || [];
    }
    if (flags & DELTA_FLAG_MINIMAP_DEATHS) {
      delta.minimapDeaths = readTaggedValue(reader) || [];
    }
    if (!reader.eof()) {
      throw new Error('HistoryStore delta payload has trailing bytes.');
    }
    return delta;
  },
};

export { historyStoreColdBlockCodecMethods };
