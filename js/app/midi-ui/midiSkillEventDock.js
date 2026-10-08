import { SoundEffectIds } from '../../game/SoundEvents.js';

const SKILL_EVENT_GROUPS = [
  { panel: 5, name: 'Blocker', events: [[SoundEffectIds.BLOCKER_TURN, 'Turn'], [SoundEffectIds.BLOCKER_CONTACT, 'Reply']] },
  { panel: 6, name: 'Builder', events: [[SoundEffectIds.BUILDER_STEP, 'Build'], [SoundEffectIds.BUILDER_WARNING, 'Warn']] },
  { panel: 7, name: 'Basher', events: [[SoundEffectIds.BASH, 'Bash']] },
  { panel: 8, name: 'Miner', events: [[SoundEffectIds.MINE, 'Mine']] },
  { panel: 9, name: 'Digger', events: [[SoundEffectIds.DIG, 'Dig']] }
];

const resolveSkillDockGeometry = (stage, canvasWidth) => {
  const gui = stage?.guiImgProps, raw = gui?.display?.worldDataSize;
  if (!raw?.width || !gui?.viewPoint?.scale || stage.guiEnabled === false || !stage.stageCav?.width || !canvasWidth) return null;
  const ratio = canvasWidth / stage.stageCav.width, cell = 16 * gui.viewPoint.scale * ratio;
  return { compact: cell < 28, left: (gui.x + 5 * 16 * gui.viewPoint.scale) * ratio,
    width: cell * 5, overlap: (stage.hudMargin || 0) * ratio };
};

/** Move the existing cards; the canvas continues to own skill selection and assignment. */
const createMidiSkillEventDock = ({ document, window, getLemmings, getRows }) => {
  const root = document?.getElementById('midiSkillEventDock'), list = document?.getElementById('midiGameEventList');
  const slots = new Map(); let groups = null, geometryKey = null, enabled = false;
  if (root) {
    groups = document.createElement('div'); groups.className = 'midi-skill-event-groups'; root.appendChild(groups);
    for (const group of SKILL_EVENT_GROUPS) {
      const slot = document.createElement('div'); slot.className = 'midi-skill-event-slot'; slot.setAttribute('role', 'group'); slot.setAttribute('aria-label', group.name + ' sounds');
      slot.dataset.skillPanel = String(group.panel); groups.appendChild(slot);
      for (const [id, label] of group.events) slots.set(id, { slot, label });
    }
  }
  const sync = visible => {
    enabled = !!visible;
    if (!root || !list) return;
    const view = getLemmings(), canvas = document.getElementById('gameCanvas');
    const rows = getRows(), stage = view?.stage;
    const geometry = resolveSkillDockGeometry(stage, canvas?.clientWidth);
    const active = !!visible && !!geometry && rows.some(row => slots.has(Number(row.dataset.gameEventId)) && !row.hidden);
    for (const row of rows) {
      const id = Number(row.dataset.gameEventId), target = active ? slots.get(id) : null;
      const destination = target?.slot || list;
      if (row.parentElement !== destination) {
        const focused = document.activeElement === row;
        destination.appendChild(row); if (focused) row.focus?.({ preventScroll: true });
      }
      const label = row.querySelector?.('strong'), summary = row.querySelector?.('.midi-event-summary');
      const labelText = target ? target.label : row.dataset.eventLabel;
      if (label && label.textContent !== labelText) label.textContent = labelText;
      if (summary) summary.textContent = target ? row.dataset.noteLabels || (row.dataset.soundEnabled === 'false' ? 'Off' : '—') : row.dataset.fullSummary;
    }
    if (active) {
      const key = [geometry.compact, geometry.left, geometry.width, geometry.overlap].join(':');
      if (key !== geometryKey) {
        geometryKey = key; root.classList.toggle('is-compact', geometry.compact);
        groups.style.left = (geometry.compact ? 0 : geometry.left) + 'px'; groups.style.width = (geometry.compact ? canvas.clientWidth : geometry.width) + 'px';
        root.style.marginTop = -geometry.overlap + 'px';
      }
    }
    if (root.hidden === active) {
      root.hidden = !active;
      window?.dispatchEvent?.(new window.Event('resize'));
    }
  };
  // CSS canvas size changes when Studio moves or closes, even with fixed backing pixels.
  const observer = typeof window?.ResizeObserver === 'function' ? new window.ResizeObserver(() => sync(enabled)) : null;
  const canvas = document?.getElementById('gameCanvas'); if (canvas) observer?.observe(canvas);
  return { sync, dispose: () => { observer?.disconnect(); sync(false); root?.replaceChildren?.(); } };
};

export { SKILL_EVENT_GROUPS, resolveSkillDockGeometry, createMidiSkillEventDock };
