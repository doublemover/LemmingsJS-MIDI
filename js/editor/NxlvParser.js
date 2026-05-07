import { EditorLevel } from './EditorLevel.js';
import { createEntry as createEditorEntry } from './EditorEntryFactory.js';

const HEADER_NUMERIC_KEYS = new Set([
  'LEMMINGS',
  'SAVE_REQUIREMENT',
  'TIME_LIMIT',
  'MAX_SPAWN_INTERVAL',
  'WIDTH',
  'HEIGHT',
  'START_X',
  'START_Y'
]);

const HEADER_BOOLEAN_KEYS = new Set([
  'SPAWN_INTERVAL_LOCKED'
]);

const ENTRY_NUMERIC_KEYS = new Set([
  'X',
  'Y',
  'PIECE',
  'ROTATE',
  'WIDTH',
  'HEIGHT',
  'PAIRING',
  'SKILL',
  'LEMMINGS',
  'MIDI_FLAG_ID',
  'MIDI_FLAG_COOLDOWN'
]);

const ENTRY_BOOLEAN_KEYS = new Set([
  'FLIP_HORIZONTAL',
  'FLIP_VERTICAL',
  'NO_OVERWRITE',
  'ERASE',
  'ONE_WAY',
  'STEEL',
  'MIDI_FLAG'
]);

function parseNumberValue(value) {
  const trimmed = String(value).trim();
  if (!trimmed) return value;
  if (/^x[0-9a-f]+$/i.test(trimmed)) {
    return parseInt(trimmed.slice(1), 16);
  }
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }
  return value;
}

function parseBooleanValue(value) {
  const trimmed = String(value).trim().toLowerCase();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === '1') return true;
  if (trimmed === '0') return false;
  return value;
}

function parseValueForKey(key, value, numericKeys, booleanKeys) {
  if (value === 'INFINITE') return value;
  if (booleanKeys.has(key)) return parseBooleanValue(value);
  if (numericKeys.has(key)) return parseNumberValue(value);
  return value;
}

function parseKeyValue(line) {
  const idx = line.indexOf(' ');
  if (idx === -1) {
    return { key: EditorLevel.normalizeKey(line), value: '' };
  }
  const key = EditorLevel.normalizeKey(line.slice(0, idx));
  const value = line.slice(idx + 1).trim();
  return { key, value };
}

function createGroup() {
  return { props: {}, order: [], terrains: [], unknownLines: [] };
}

function applyProperty(target, key, value) {
  if (!Object.prototype.hasOwnProperty.call(target.props, key)) {
    target.order.push(key);
  }
  target.props[key] = value;
}

function pushUnknownLine(level, ctx, line) {
  if (!ctx) {
    level.unknownLines.push(line);
    return;
  }
  if (ctx.type === 'UNKNOWN') {
    ctx.data.lines.push(line);
    return;
  }
  if (ctx.type === 'SKILLSET') {
    ctx.data.unknownLines.push(line);
    return;
  }
  if (Array.isArray(ctx.data?.unknownLines)) {
    ctx.data.unknownLines.push(line);
    return;
  }
  level.unknownLines.push(line);
}

class NxlvParser {
  parse(text) {
    const level = new EditorLevel();
    const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
    const stack = [];

    const closeContext = (ctx, parent) => {
      if (!ctx) return;
      switch (ctx.type) {
      case 'SKILLSET':
        level.skillset = ctx.data.skills;
        if (ctx.data.unknownLines.length) {
          if (!Array.isArray(level.skillsetUnknownLines)) {
            level.skillsetUnknownLines = [];
          }
          level.skillsetUnknownLines.push(...ctx.data.unknownLines);
        }
        break;
      case 'TERRAIN':
        if (parent && parent.type === 'TERRAINGROUP') {
          parent.data.terrains.push(ctx.data);
        } else {
          level.terrains.push(ctx.data);
        }
        break;
      case 'GADGET':
        level.gadgets.push(ctx.data);
        break;
      case 'STEEL':
        level.steel.push(ctx.data);
        break;
      case 'TERRAINGROUP':
        level.terrainGroups.push(ctx.data);
        break;
      case 'UNKNOWN':
        level.unknownSections.push(ctx.data);
        break;
      }
    };

    for (const rawLine of lines) {
      const trimmed = rawLine.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('#')) {
        const ctx = stack[stack.length - 1];
        pushUnknownLine(level, ctx, rawLine);
        continue;
      }
      if (trimmed.startsWith('$')) {
        const sectionName = EditorLevel.normalizeKey(trimmed.slice(1));
        if (sectionName === 'END') {
          const ctx = stack.pop();
          const parent = stack[stack.length - 1];
          closeContext(ctx, parent);
          continue;
        }
        switch (sectionName) {
        case 'SKILLSET':
          stack.push({ type: 'SKILLSET', data: { skills: new Map(), unknownLines: [] } });
          break;
        case 'TERRAIN':
          stack.push({ type: 'TERRAIN', data: createEditorEntry({}, null, { prefix: 't' }) });
          break;
        case 'GADGET':
          stack.push({ type: 'GADGET', data: createEditorEntry({}, null, { prefix: 'g' }) });
          break;
        case 'STEEL':
          stack.push({ type: 'STEEL', data: createEditorEntry({}, null, { prefix: 's' }) });
          break;
        case 'TERRAINGROUP':
          stack.push({ type: 'TERRAINGROUP', data: createGroup() });
          break;
        default:
          stack.push({ type: 'UNKNOWN', data: { name: sectionName, lines: [] } });
          break;
        }
        continue;
      }

      const ctx = stack[stack.length - 1];
      if (!ctx) {
        const { key, value } = parseKeyValue(trimmed);
        const parsed = parseValueForKey(key, value, HEADER_NUMERIC_KEYS, HEADER_BOOLEAN_KEYS);
        level.setHeader(key, parsed);
        continue;
      }

      if (ctx.type === 'SKILLSET') {
        const parts = trimmed.split(/\s+/);
        if (parts.length >= 3 && EditorLevel.normalizeKey(parts[0]) === 'SKILL') {
          const skill = EditorLevel.normalizeKey(parts[1]);
          const rawValue = parts.slice(2).join(' ');
          const value = rawValue === 'INFINITE' ? 'INFINITE' : parseNumberValue(rawValue);
          ctx.data.skills.set(skill, value);
        } else {
          ctx.data.unknownLines.push(rawLine);
        }
        continue;
      }

      if (ctx.type === 'TERRAIN' || ctx.type === 'GADGET' || ctx.type === 'STEEL') {
        const { key, value } = parseKeyValue(trimmed);
        const parsed = parseValueForKey(key, value, ENTRY_NUMERIC_KEYS, ENTRY_BOOLEAN_KEYS);
        applyProperty(ctx.data, key, parsed);
        continue;
      }

      if (ctx.type === 'TERRAINGROUP') {
        const { key, value } = parseKeyValue(trimmed);
        const parsed = parseValueForKey(key, value, ENTRY_NUMERIC_KEYS, ENTRY_BOOLEAN_KEYS);
        applyProperty(ctx.data, key, parsed);
        continue;
      }

      if (ctx.type === 'UNKNOWN') {
        ctx.data.lines.push(rawLine);
        continue;
      }
    }

    while (stack.length) {
      const ctx = stack.pop();
      const parent = stack[stack.length - 1];
      closeContext(ctx, parent);
    }

    return level;
  }

  static parse(text) {
    return new NxlvParser().parse(text);
  }
}

export { NxlvParser };

const __test__ = {
  pushUnknownLine
};

export { __test__ };
