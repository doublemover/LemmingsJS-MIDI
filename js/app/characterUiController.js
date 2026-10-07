import { CHARACTER_STORAGE_KEY, getCharacterPreference, setCharacterPreference } from '../lemmings/CharacterSpriteSet.js';
import { CHARACTER_COLORS } from '../lemmings/characterColors.js';
import { CHARACTER_ACCESSORIES, ACCESSORY_SLOTS } from '../lemmings/CharacterAccessories.js';

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
    for (const slot of ACCESSORY_SLOTS) {
      for (const suffix of ['', 'Color', 'Palette']) {
        const control = byId(`characterAccessory-${slot}${suffix}`);
        if (control) control.disabled = select.value === 'classic';
      }
    }
    const ok = await sprites.prepare();
    if (request !== generation) return;
    const status = byId('characterStatus');
    if (status) status.textContent = ok ? preference.shape === 'mixed' ? 'Mixed by stable actor ID; rewind keeps each body.' : 'Presentation only; game timing and collisions unchanged.' : `Character art unavailable: ${sprites.error}. Classic art remains available.`;
    getView()?.game?.render?.();
  };
  const change = () => {
    const current = getCharacterPreference();
    const accessories = { ...current.accessories }, accessoryColors = { ...current.accessoryColors };
    for (const slot of ACCESSORY_SLOTS) {
      const select = byId(`characterAccessory-${slot}`), color = byId(`characterAccessory-${slot}Color`);
      if (select) accessories[slot] = select.value;
      if (color) accessoryColors[slot] = color.value;
    }
    const next = setCharacterPreference({ shape: byId('characterShape')?.value,
      bodyColor: byId('characterCustomColors')?.checked ? byId('characterBodyColor')?.value : null,
      propColor: byId('characterCustomColors')?.checked ? byId('characterPropColor')?.value : null,
      accessories, accessoryColors });
    try { window?.localStorage?.setItem(CHARACTER_STORAGE_KEY, JSON.stringify(next)); } catch { /* Apply for this session even if storage is full. */ }
    sync();
  };
  const bind = () => {
    const p = getCharacterPreference();
    for (const slot of ACCESSORY_SLOTS) {
      const select = byId(`characterAccessory-${slot}`);
      const input = byId(`characterAccessory-${slot}Color`);
      const palette = byId(`characterAccessory-${slot}Palette`);
      if (!select || !input || !palette) continue;
      select.replaceChildren();
      for (const item of [{ id: 'none', label: 'None' }, ...CHARACTER_ACCESSORIES[slot]]) {
        const option = document.createElement('option'); option.value = item.id; option.textContent = item.label; select.appendChild(option);
      }
      select.value = p.accessories?.[slot] || 'none';
      input.value = p.accessoryColors?.[slot] || '#ff813d';
      palette.replaceChildren();
      for (const [value, label] of [['#ff813d', 'Original Hydro'], ['custom', 'Custom color'], ...CHARACTER_COLORS.prop.map(color => [color.hex, color.label])]) {
        const option = document.createElement('option'); option.value = value; option.textContent = label; palette.appendChild(option);
      }
      const syncPalette = () => { palette.value = input.value === '#ff813d' || CHARACTER_COLORS.prop.some(color => color.hex === input.value) ? input.value : 'custom'; };
      syncPalette();
      select.addEventListener('change', change);
      input.addEventListener('change', () => { syncPalette(); change(); });
      palette.addEventListener('change', () => {
        if (palette.value === 'custom') { input.focus(); return; }
        input.value = palette.value; change();
      });
    }
    if (byId('characterCustomColors')) byId('characterCustomColors').checked = !!(p.bodyColor || p.propColor);
    if (byId('characterBodyColor')) byId('characterBodyColor').value = p.bodyColor || '#2b6ff6';
    if (byId('characterPropColor')) byId('characterPropColor').value = p.propColor || '#ff813d';
    for (const [part, colors] of Object.entries(CHARACTER_COLORS)) {
      const prefix = `character${part === 'body' ? 'Body' : 'Prop'}`;
      const select = byId(`${prefix}Palette`);
      const input = byId(`${prefix}Color`);
      if (!select || !input) continue;
      select.replaceChildren();
      const original = part === 'body' ? '#2b6ff6' : '#ff813d';
      for (const [value, label] of [['original', 'Original Hydro'], ['custom', 'Custom color'], ...colors.map(color => [color.hex, color.label])]) {
        const option = document.createElement('option'); option.value = value; option.textContent = label; select.appendChild(option);
      }
      const syncPalette = () => { select.value = colors.some(color => color.hex === input.value) ? input.value : input.value === original ? 'original' : 'custom'; };
      syncPalette();
      select.addEventListener('change', () => {
        if (select.value === 'custom') { input.focus(); return; }
        input.value = select.value === 'original' ? original : select.value;
        byId('characterCustomColors').checked = true;
        change();
      });
      input.addEventListener('change', syncPalette);
    }
    for (const id of ['characterShape', 'characterCustomColors', 'characterBodyColor', 'characterPropColor']) byId(id)?.addEventListener('change', change);
  };
  return { bind, sync };
};

export { createCharacterUiController };
