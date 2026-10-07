import { CHARACTER_STORAGE_KEY, getCharacterPreference, setCharacterPreference } from '../lemmings/CharacterSpriteSet.js';
import { CHARACTER_COLORS } from '../lemmings/characterColors.js';
import { CHARACTER_ACCESSORIES, CHARACTER_ACCESSORY_CHOICES } from '../lemmings/CharacterAccessories.js';

const CHARACTER_FIELDS = [
  ['characterShape', 'Body shape', 'shape-choices'],
  ['characterBodyPalette', 'Body color', 'palette-choices body-palette'],
  ['characterAccessory', 'Accessory', 'accessory-choices'],
  ['characterPropPalette', 'Accessory color', 'palette-choices'],
  ['characterEyewear', 'Eyewear', 'eyewear-choices'],
  ['characterEyewearPalette', 'Frame color', 'palette-choices']
];
const mountCharacterControls = (document, container) => {
  for (const [id, label, classes] of CHARACTER_FIELDS) {
    const field = document.createElement('div'); field.className = 'character-field';
    const caption = document.createElement('span'); caption.id = `${id}Label`; caption.textContent = label;
    const select = document.createElement('select'); select.id = id; select.hidden = true; select.setAttribute('aria-label', label);
    const choices = document.createElement('div'); choices.id = `${id}Choices`; choices.className = `character-segments ${classes}`;
    choices.setAttribute('role', 'radiogroup'); choices.setAttribute('aria-labelledby', caption.id);
    field.append(caption, select, choices); container.appendChild(field);
  }
  const status = document.createElement('span'); status.id = 'characterStatus'; status.setAttribute('role', 'status'); container.appendChild(status);
};
const createCharacterUiController = ({ document, window, getView }) => {
  const byId = id => document?.getElementById(id);
  let generation = 0;
  try {
    const saved = JSON.parse(window?.localStorage?.getItem(CHARACTER_STORAGE_KEY) || 'null');
    if (saved) setCharacterPreference(saved);
  } catch { /* Invalid stored appearance uses the ready default. */ }
  const persist = preference => {
    try { window?.localStorage?.setItem(CHARACTER_STORAGE_KEY, JSON.stringify(preference)); } catch { /* Session choices still apply. */ }
  };
  const showSelection = (id, selected, disabled = false) => {
    const select = byId(id);
    if (select) { select.value = selected; select.disabled = disabled; }
    for (const button of Array.from(byId(`${id}Choices`)?.children || [])) {
      const checked = button.dataset.value === selected;
      button.setAttribute('aria-checked', String(checked)); button.tabIndex = checked ? 0 : -1; button.disabled = disabled;
    }
  };
  const fillChoices = (id, items) => {
    const select = byId(id), group = byId(`${id}Choices`);
    if (!select) return;
    const key = items.map(item => item.id).join(',');
    if (select.dataset.options === key) return;
    while (select.firstChild) select.removeChild(select.firstChild);
    if (group) while (group.firstChild) group.removeChild(group.firstChild);
    for (const item of items) {
      const option = document.createElement('option'); option.value = item.id; option.textContent = item.label; select.appendChild(option);
      if (!group) continue;
      const button = document.createElement('button'); button.type = 'button'; button.dataset.value = item.id;
      button.setAttribute('role', 'radio'); button.setAttribute('aria-label', item.label); button.title = item.label;
      if (item.hex) {
        const swatch = document.createElement('span'); swatch.className = 'character-swatch'; swatch.style.backgroundColor = item.hex;
        swatch.setAttribute('aria-hidden', 'true'); button.appendChild(swatch);
      } else if (item.image) {
        const image = document.createElement('img'); image.src = item.image; image.alt = ''; image.width = 32; image.height = 32; button.appendChild(image);
      } else {
        button.dataset.icon = item.id === 'classic' ? 'shapes' : 'dice-5';
        const label = document.createElement('span'); label.className = 'visually-hidden'; label.textContent = item.label; button.appendChild(label);
      }
      button.addEventListener('click', () => { select.value = item.id; change(); });
      button.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault?.(); event.stopPropagation?.();
        const buttons = Array.from(group.children), index = buttons.indexOf(button);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
          : (index + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1) + buttons.length) % buttons.length;
        buttons[next].focus?.(); select.value = buttons[next].dataset.value; change();
      });
      group.appendChild(button);
    }
    select.dataset.options = key;
  };
  const sync = async () => {
    const request = ++generation;
    const sprites = getView()?.game?.gameResources?.characterSprites;
    if (!byId('characterShape') || !sprites) return;
    fillChoices('characterShape', [
      { id: 'mixed', label: 'Stable mix of all shapes' },
      ...sprites.shapes.map(shape => ({ id: shape.id, label: shape.label.replace(/^Hydro\s+/i, ''), image: `assets/characters/previews/body-${shape.id}.svg` })),
      { id: 'classic', label: 'Original lemmings' }
    ]);
    const p = getCharacterPreference(), classic = p.shape === 'classic';
    showSelection('characterShape', p.shape);
    for (const [id, selected] of [
      ['characterBodyPalette', p.bodyColor || '#4778ff'], ['characterPropPalette', p.propColor || '#ff8066'],
      ['characterAccessory', p.accessory || 'beret'], ['characterEyewear', p.eyewear || 'none'], ['characterEyewearPalette', p.eyewearColor || '#1f1f1f']
    ]) showSelection(id, selected, classic);
    const status = byId('characterStatus');
    if (status) status.textContent = 'Preparing appearance…';
    const ok = await sprites.prepare();
    if (request !== generation) return;
    if (status) status.textContent = ok ? p.shape === 'mixed' ? 'All shapes · stable character identities' : 'Appearance ready · gameplay unchanged'
      : `${sprites.activePreference ? 'Could not load this appearance. Keeping the previous look.' : 'Character art unavailable. Choose an appearance to retry.'} ${sprites.error || ''}`;
    getView()?.game?.render?.();
  };
  const change = () => {
    const current = getCharacterPreference();
    const next = setCharacterPreference({ ...current, shape: byId('characterShape')?.value || current.shape,
      accessory: byId('characterAccessory')?.value || current.accessory,
      eyewear: byId('characterEyewear')?.value || current.eyewear,
      bodyColor: byId('characterBodyPalette')?.value || current.bodyColor,
      propColor: byId('characterPropPalette')?.value || current.propColor,
      eyewearColor: byId('characterEyewearPalette')?.value || current.eyewearColor });
    persist(next); sync();
  };
  const bind = () => {
    const current = getCharacterPreference();
    const p = setCharacterPreference({ ...current, bodyColor: current.bodyColor || '#4778ff', propColor: current.propColor || '#ff8066', eyewearColor: current.eyewearColor || '#1f1f1f' });
    persist(p);
    for (const [id, items, value, prefix] of [
      ['characterAccessory', CHARACTER_ACCESSORY_CHOICES, p.accessory || 'beret', 'accessory'],
      ['characterEyewear', [{ id: 'none', label: 'No eyewear' }, ...CHARACTER_ACCESSORIES.eyewear], p.eyewear || 'none', 'eyewear']
    ]) {
      fillChoices(id, items.map(item => ({ ...item, image: `assets/characters/previews/${prefix}-${item.id}.svg` })));
      showSelection(id, value);
    }
    for (const [id, colors, selected] of [
      ['characterBodyPalette', CHARACTER_COLORS.body, p.bodyColor], ['characterPropPalette', CHARACTER_COLORS.prop, p.propColor],
      ['characterEyewearPalette', CHARACTER_COLORS.prop, p.eyewearColor]
    ]) {
      fillChoices(id, [{ id: 'random', label: 'Stable random colors' }, ...colors.map(color => ({ ...color, id: color.hex }))]);
      showSelection(id, selected);
    }
    for (const [id] of CHARACTER_FIELDS) byId(id)?.addEventListener('change', change);
  };
  return { bind, sync };
};

export { createCharacterUiController, mountCharacterControls };
