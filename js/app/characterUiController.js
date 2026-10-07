import { CHARACTER_STORAGE_KEY, getCharacterPreference, setCharacterPreference } from '../lemmings/CharacterSpriteSet.js';
import { CHARACTER_COLORS } from '../lemmings/characterColors.js';
import { CHARACTER_ACCESSORIES, CHARACTER_ACCESSORY_CHOICES } from '../lemmings/CharacterAccessories.js';

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
    for (const id of ['characterAccessory', 'characterEyewear', 'characterEyewearColor', 'characterEyewearPalette']) {
      if (byId(id)) byId(id).disabled = select.value === 'classic';
    }
    const ok = await sprites.prepare();
    if (request !== generation) return;
    const status = byId('characterStatus');
    if (status) status.textContent = ok ? preference.shape === 'mixed' ? 'Mixed by stable actor ID; rewind keeps each body.' : 'Presentation only; game timing and collisions unchanged.' : `Character art unavailable: ${sprites.error}. Classic art remains available.`;
    getView()?.game?.render?.();
  };
  const change = () => {
    const current = getCharacterPreference();
    const next = setCharacterPreference({ shape: byId('characterShape')?.value,
      accessory: byId('characterAccessory')?.value || current.accessory,
      eyewear: byId('characterEyewear')?.value || current.eyewear,
      eyewearColor: byId('characterEyewearColor')?.value || current.eyewearColor,
      bodyColor: byId('characterCustomColors')?.checked ? byId('characterBodyColor')?.value : null,
      propColor: byId('characterCustomColors')?.checked ? byId('characterPropColor')?.value : null });
    try { window?.localStorage?.setItem(CHARACTER_STORAGE_KEY, JSON.stringify(next)); } catch { /* Apply for this session even if storage is full. */ }
    sync();
  };
  const bind = () => {
    const p = getCharacterPreference();
    for (const [id, items, value] of [
      ['characterAccessory', CHARACTER_ACCESSORY_CHOICES, p.accessory || 'beret'],
      ['characterEyewear', [{ id: 'none', label: 'None' }, ...CHARACTER_ACCESSORIES.eyewear], p.eyewear || 'none']
    ]) {
      const select = byId(id);
      if (!select) continue;
      select.replaceChildren();
      for (const item of items) {
        const option = document.createElement('option'); option.value = item.id; option.textContent = item.label; select.appendChild(option);
      }
      select.value = value;
      select.addEventListener('change', change);
    }
    if (byId('characterCustomColors')) byId('characterCustomColors').checked = !!(p.bodyColor || p.propColor);
    if (byId('characterBodyColor')) byId('characterBodyColor').value = p.bodyColor || '#2b6ff6';
    if (byId('characterPropColor')) byId('characterPropColor').value = p.propColor || '#ff813d';
    if (byId('characterEyewearColor')) byId('characterEyewearColor').value = p.eyewearColor || '#1f1f1f';
    for (const [part, colors] of [...Object.entries(CHARACTER_COLORS), ['eyewear', CHARACTER_COLORS.prop]]) {
      const prefix = `character${part === 'body' ? 'Body' : part === 'eyewear' ? 'Eyewear' : 'Prop'}`;
      const select = byId(`${prefix}Palette`);
      const input = byId(`${prefix}Color`);
      if (!select || !input) continue;
      select.replaceChildren();
      const original = part === 'body' ? '#2b6ff6' : part === 'eyewear' ? '#1f1f1f' : '#ff813d';
      for (const [value, label] of [['original', part === 'eyewear' ? 'Original charcoal' : 'Original Hydro'], ['custom', 'Custom color'], ...colors.map(color => [color.hex, color.label])]) {
        const option = document.createElement('option'); option.value = value; option.textContent = label; select.appendChild(option);
      }
      const syncPalette = () => { select.value = colors.some(color => color.hex === input.value) ? input.value : input.value === original ? 'original' : 'custom'; };
      syncPalette();
      select.addEventListener('change', () => {
        if (select.value === 'custom') { input.focus(); return; }
        input.value = select.value === 'original' ? original : select.value;
        if (part !== 'eyewear') byId('characterCustomColors').checked = true;
        change();
      });
      input.addEventListener('change', syncPalette);
    }
    for (const id of ['characterShape', 'characterCustomColors', 'characterBodyColor', 'characterPropColor', 'characterEyewearColor']) byId(id)?.addEventListener('change', change);
  };
  return { bind, sync };
};

export { createCharacterUiController };
