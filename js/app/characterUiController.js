import { CHARACTER_STORAGE_KEY, getCharacterPreference, setCharacterPreference } from '../lemmings/CharacterSpriteSet.js';

const createCharacterUiController = ({ document, window, getView }) => {
  const byId = id => document?.getElementById(id);
  let generation = 0;
  try { const saved = JSON.parse(window?.localStorage?.getItem(CHARACTER_STORAGE_KEY) || 'null'); if (saved) setCharacterPreference(saved); } catch { /* A malformed preference leaves classic art available. */ }
  const sync = async () => {
    const request = ++generation;
    const sprites = getView()?.game?.gameResources?.characterSprites;
    const select = byId('characterShape');
    if (!select || !sprites) return;
    const options = [['classic', 'Classic lemmings'], ...sprites.shapes.map(shape => [shape.id, shape.label]), ['mixed', 'Random mix · stable IDs']];
    const key = options.map(option => option[0]).join(',');
    if (select.dataset.options !== key) {
      select.replaceChildren();
      for (const [value, label] of options) { const option = document.createElement('option'); option.value = value; option.textContent = label; select.appendChild(option); }
      select.dataset.options = key;
    }
    const preference = getCharacterPreference();
    select.value = options.some(([value]) => value === preference.shape) ? preference.shape : 'classic';
    select.disabled = false;
    const ok = await sprites.prepare();
    if (request !== generation) return;
    const status = byId('characterStatus');
    if (status) status.textContent = ok ? preference.shape === 'mixed' ? 'Mixed by stable actor ID; rewind keeps each body.' : 'Presentation only; game timing and collisions unchanged.' : `Character art unavailable: ${sprites.error}. Classic art remains available.`;
    getView()?.game?.render?.();
  };
  const change = () => {
    const next = setCharacterPreference({ shape: byId('characterShape')?.value,
      bodyColor: byId('characterCustomColors')?.checked ? byId('characterBodyColor')?.value : null,
      propColor: byId('characterCustomColors')?.checked ? byId('characterPropColor')?.value : null });
    try { window?.localStorage?.setItem(CHARACTER_STORAGE_KEY, JSON.stringify(next)); } catch { /* Apply for this session even if storage is full. */ }
    sync();
  };
  const bind = () => {
    const p = getCharacterPreference();
    if (byId('characterCustomColors')) byId('characterCustomColors').checked = !!(p.bodyColor || p.propColor);
    if (byId('characterBodyColor')) byId('characterBodyColor').value = p.bodyColor || '#2b6ff6';
    if (byId('characterPropColor')) byId('characterPropColor').value = p.propColor || '#ff813d';
    for (const id of ['characterShape', 'characterCustomColors', 'characterBodyColor', 'characterPropColor']) byId(id)?.addEventListener('change', change);
  };
  return { bind, sync };
};

export { createCharacterUiController };
