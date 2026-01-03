const KEY_LABELS = new Map([
  ['ArrowLeft', 'Left'],
  ['ArrowRight', 'Right'],
  ['ArrowUp', 'Up'],
  ['ArrowDown', 'Down'],
  ['BracketLeft', '['],
  ['BracketRight', ']'],
  ['Backquote', '`'],
  ['Backslash', '\\'],
  ['Minus', '-'],
  ['Equal', '='],
  ['Comma', ','],
  ['Period', '.'],
  ['NumpadAdd', 'Numpad+'],
  ['NumpadSubtract', 'Numpad-'],
  ['Space', 'Space'],
  ['Backspace', 'Backspace'],
  ['Delete', 'Delete'],
  ['Tab', 'Tab']
]);

const formatKeyCode = (code) => {
  if (!code) return '';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return KEY_LABELS.get(code) || code;
};

const formatBindingSpec = (spec) => {
  if (!spec) return '';
  const parts = [];
  if (spec.ctrl) parts.push('Ctrl');
  if (spec.alt) parts.push('Alt');
  if (spec.shift) parts.push('Shift');
  if (spec.meta) parts.push('Meta');
  const code = formatKeyCode(spec.code);
  if (code) parts.push(code);
  return parts.join('+');
};

export { formatBindingSpec, formatKeyCode };
