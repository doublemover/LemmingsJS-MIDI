import crypto from 'node:crypto';

const KEY_ALIASES = new Map([
  ['Ctrl', 'Control'],
  ['ControlLeft', 'Control'],
  ['ControlRight', 'Control'],
  ['Cmd', 'Meta'],
  ['Command', 'Meta'],
  ['MetaLeft', 'Meta'],
  ['MetaRight', 'Meta'],
  ['AltLeft', 'Alt'],
  ['AltRight', 'Alt'],
  ['Option', 'Alt'],
  ['ShiftLeft', 'Shift'],
  ['ShiftRight', 'Shift']
]);


const nowIso = () => new Date().toISOString();

const makeId = (bytes = 9) => crypto.randomBytes(bytes)
  .toString('base64')
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=+$/g, '');

const normalizeKeyToken = (token) => {
  const raw = String(token || '');
  return KEY_ALIASES.get(raw) || raw;
};

const normalizeKeyChord = (chord) => String(chord || '')
  .split('+')
  .map((part) => normalizeKeyToken(part.trim()))
  .filter(Boolean)
  .join('+');

const formatToMime = (format) => {
  switch (format) {
  case 'jpeg':
    return 'image/jpeg';
  case 'webp':
    return 'image/webp';
  default:
    return 'image/png';
  }
};


const toToolName = (name) => String(name).replace(/\./g, '_');

const buildToolResponse = (payload) => ({
  content: [{ type: 'text', text: JSON.stringify(payload) }],
  structuredContent: payload
});

const buildProtocolMetadata = ({
  protocolVersion,
  schemaFrozenAt,
  skillNames,
  lemmingDeltaFields
}) => ({
  version: protocolVersion,
  schemaFrozenAt,
  acceptedToolNameForms: ['underscore'],
  unsupportedOptions: {
    spectatorOpenBrowser: true
  },
  skillNames,
  lemmingDeltaFields
});

export {
  buildProtocolMetadata,
  buildToolResponse,
  formatToMime,
  makeId,
  normalizeKeyChord,
  normalizeKeyToken,
  nowIso,
  toToolName
};
