import { EditorLevel } from './EditorLevel.js';

const HEADER_ORDER = [
  'TITLE',
  'AUTHOR',
  'VERSION',
  'ID',
  'STYLE',
  'MUSIC',
  'LEMMINGS',
  'SAVE_REQUIREMENT',
  'TIME_LIMIT',
  'MAX_SPAWN_INTERVAL',
  'SPAWN_INTERVAL_LOCKED',
  'WIDTH',
  'HEIGHT',
  'START_X',
  'START_Y',
  'BACKGROUND'
];

const SKILL_ORDER = [
  'CLIMBER',
  'FLOATER',
  'BOMBER',
  'BLOCKER',
  'BUILDER',
  'BASHER',
  'MINER',
  'DIGGER'
];

const TERRAIN_ORDER = [
  'STYLE',
  'PIECE',
  'X',
  'Y',
  'ROTATE',
  'FLIP_HORIZONTAL',
  'FLIP_VERTICAL',
  'NO_OVERWRITE',
  'ERASE',
  'ONE_WAY',
  'WIDTH',
  'HEIGHT'
];

const GADGET_ORDER = [
  'STYLE',
  'PIECE',
  'X',
  'Y',
  'ROTATE',
  'FLIP_HORIZONTAL',
  'FLIP_VERTICAL',
  'WIDTH',
  'HEIGHT',
  'SKILL',
  'LEMMINGS',
  'PAIRING'
];

const STEEL_ORDER = [
  'X',
  'Y',
  'WIDTH',
  'HEIGHT'
];

const GROUP_ORDER = [
  'STEEL',
  'STYLE'
];

function formatValue(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return String(value);
}

function writeKeyValue(key, value, indent) {
  if (value === undefined || value === null || value === '') {
    return `${indent}${key}`;
  }
  return `${indent}${key} ${formatValue(value)}`;
}

function getOrderedKeys(order, props, fallbackOrder) {
  const keys = [];
  const seen = new Set();
  const baseOrder = Array.isArray(order) && order.length ? order : fallbackOrder;
  for (const key of baseOrder) {
    if (Object.prototype.hasOwnProperty.call(props, key) && !seen.has(key)) {
      keys.push(key);
      seen.add(key);
    }
  }
  for (const key of Object.keys(props).sort()) {
    if (!seen.has(key)) {
      keys.push(key);
      seen.add(key);
    }
  }
  return keys;
}

function writeEntry(section, entry, fallbackOrder, indent = '') {
  const lines = [];
  const props = entry?.props || {};
  const order = entry?.order || [];
  const unknownLines = entry?.unknownLines || [];

  lines.push(`${indent}$${section}`);
  const keys = getOrderedKeys(order, props, fallbackOrder);
  for (const key of keys) {
    lines.push(writeKeyValue(key, props[key], `${indent}  `));
  }
  for (const line of unknownLines) {
    lines.push(`${indent}  ${line.trim()}`);
  }
  lines.push(`${indent}$END`);
  return lines;
}

class NxlvWriter {
  write(level) {
    const out = [];
    const header = level?.header || {};
    const headerOrder = Array.isArray(level?.headerOrder) && level.headerOrder.length
      ? level.headerOrder
      : HEADER_ORDER;

    for (const key of headerOrder) {
      if (Object.prototype.hasOwnProperty.call(header, key)) {
        out.push(writeKeyValue(key, header[key], ''));
      }
    }
    const remainingKeys = Object.keys(header)
      .filter(key => !headerOrder.includes(key))
      .sort();
    for (const key of remainingKeys) {
      out.push(writeKeyValue(key, header[key], ''));
    }

    if (level?.skillset && level.skillset.size) {
      out.push('$SKILLSET');
      const seen = new Set();
      for (const skill of SKILL_ORDER) {
        if (level.skillset.has(skill)) {
          out.push(`  SKILL ${skill} ${formatValue(level.skillset.get(skill))}`);
          seen.add(skill);
        }
      }
      const remaining = Array.from(level.skillset.keys())
        .filter(skill => !seen.has(skill))
        .sort();
      for (const skill of remaining) {
        out.push(`  SKILL ${skill} ${formatValue(level.skillset.get(skill))}`);
      }
      out.push('$END');
    }

    if (Array.isArray(level?.terrainGroups)) {
      for (const group of level.terrainGroups) {
        out.push('$TERRAINGROUP');
        const keys = getOrderedKeys(group.order || [], group.props || {}, GROUP_ORDER);
        for (const key of keys) {
          out.push(writeKeyValue(key, group.props[key], '  '));
        }
        const groupUnknown = group.unknownLines || [];
        for (const line of groupUnknown) {
          out.push(`  ${line.trim()}`);
        }
        for (const terrain of group.terrains || []) {
          out.push(...writeEntry('TERRAIN', terrain, TERRAIN_ORDER, '  '));
        }
        out.push('$END');
      }
    }

    if (Array.isArray(level?.terrains)) {
      for (const terrain of level.terrains) {
        out.push(...writeEntry('TERRAIN', terrain, TERRAIN_ORDER));
      }
    }

    if (Array.isArray(level?.steel)) {
      for (const steel of level.steel) {
        out.push(...writeEntry('STEEL', steel, STEEL_ORDER));
      }
    }

    if (Array.isArray(level?.gadgets)) {
      for (const gadget of level.gadgets) {
        out.push(...writeEntry('GADGET', gadget, GADGET_ORDER));
      }
    }

    if (Array.isArray(level?.unknownSections)) {
      for (const section of level.unknownSections) {
        const name = EditorLevel.normalizeKey(section?.name || 'UNKNOWN');
        out.push(`$${name}`);
        const lines = section?.lines || [];
        for (const line of lines) {
          out.push(String(line));
        }
        out.push('$END');
      }
    }

    if (Array.isArray(level?.unknownLines)) {
      for (const line of level.unknownLines) {
        out.push(String(line));
      }
    }

    return out.join('\n');
  }

  static write(level) {
    return new NxlvWriter().write(level);
  }
}

export { NxlvWriter };
