const createServerHelpers = ({
  fs,
  keybindingsPath,
  normalizeKeyChord,
  skillNames,
  buildLemmingSummary
}) => {
  let cachedKeybindings = null;
  let cachedKeybindingsMtimeMs = NaN;
  const SKILL_NAMES = skillNames;
  const KEYBINDINGS_PATH = keybindingsPath;

  const loadKeybindings = async () => {
    const stat = await fs.stat(KEYBINDINGS_PATH);
    if (cachedKeybindings && cachedKeybindingsMtimeMs === stat.mtimeMs) {
      return cachedKeybindings;
    }
    const raw = await fs.readFile(KEYBINDINGS_PATH, 'utf8');
    cachedKeybindings = JSON.parse(raw);
    cachedKeybindingsMtimeMs = stat.mtimeMs;
    return cachedKeybindings;
  };

  const ensureBlurred = async (session) => {
    await session.page.evaluate(() => {
      const active = document.activeElement;
      if (active && typeof active.blur === 'function') {
        active.blur();
      }
    });
  };

  const callE2E = async (session, method, ...args) => session.page.evaluate(
    ({ method, args }) => {
      const api = window.__E2E__;
      if (!api || typeof api[method] !== 'function') {
        return { ok: false, error: 'harness_unavailable' };
      }
      try {
        return { ok: true, value: api[method](...args) };
      } catch (err) {
        return { ok: false, error: err ? String(err) : 'error' };
      }
    },
    { method, args }
  );

  const getState = async (session) => {
    const result = await callE2E(session, 'getState');
    return result.ok ? result.value : null;
  };

  const getTickIndex = async (session) => {
    const state = await getState(session);
    return state?.game?.timer?.tickIndex ?? null;
  };

  const filterStateSnapshot = (snapshot, include) => {
    const config = {
      view: false,
      stage: false,
      game: true,
      editor: false,
      midi: false,
      ...(include || {})
    };
    const output = {
      version: snapshot.version,
      mode: snapshot.mode,
      ready: snapshot.ready
    };

    if (config.view) output.view = snapshot.view;
    if (config.stage) output.stage = snapshot.stage;
    if (config.game) output.game = snapshot.game;
    if (config.editor) output.editor = snapshot.editor;
    if (config.midi) output.midi = snapshot.midi;

    return output;
  };

  const buildSkillInfo = (skills) => {
    if (!skills) return null;
    const counts = SKILL_NAMES.map((_, idx) => {
      const skillIndex = idx + 1;
      const raw = Array.isArray(skills.skills) ? skills.skills[skillIndex] ?? 0 : 0;
      return Number.isFinite(raw) ? raw : 99;
    });
    const cheatMode = !!skills.cheatMode;
    let availableMask = 0;
    counts.forEach((count, idx) => {
      if (cheatMode || count > 0) {
        availableMask |= (1 << idx);
      }
    });
    const selectedSkill = Number.isFinite(skills.selectedSkill) ? skills.selectedSkill : null;
    const selectedSkillName = Number.isFinite(selectedSkill)
      ? (SKILL_NAMES[selectedSkill - 1] || null)
      : null;
    return {
      selectedSkill,
      selectedSkillName,
      cheatMode,
      counts,
      availableMask
    };
  };

  const buildLemmingPrunePolicy = (state, skillInfo) => {
    const lemmings = Array.isArray(state?.game?.lemmings) ? state.game.lemmings : [];
    const availableMask = skillInfo?.availableMask ?? 0;
    const hasClimb = lemmings.some((lem) => lem?.canClimb);
    const hasParachute = lemmings.some((lem) => lem?.hasParachute);
    const hasCountdown = lemmings.some((lem) => lem?.countdownActive);
    const hasRemoved = lemmings.some((lem) => lem?.removed);
    const hasDisabled = lemmings.some((lem) => lem?.disabled);
    return {
      includeClimb: (availableMask & (1 << 0)) !== 0 || hasClimb,
      includeParachute: (availableMask & (1 << 1)) !== 0 || hasParachute,
      includeCountdown: (availableMask & (1 << 2)) !== 0 || hasCountdown,
      includeRemoved: hasRemoved,
      includeDisabled: hasDisabled
    };
  };

  const pruneLemming = (lem, policy) => {
    if (!lem) return null;
    const output = {
      id: lem.id,
      x: lem.x,
      y: lem.y,
      state: lem.state ?? null,
      actionType: lem.actionType ?? null
    };
    if (policy?.includeClimb && lem.canClimb) output.canClimb = true;
    if (policy?.includeParachute && lem.hasParachute) output.hasParachute = true;
    if (policy?.includeCountdown) {
      if (lem.countdownActive) output.countdownActive = true;
      if (Number.isFinite(lem.countdown) && lem.countdown > 0) output.countdown = lem.countdown;
    }
    if (policy?.includeRemoved && lem.removed) output.removed = true;
    if (policy?.includeDisabled && lem.disabled) output.disabled = true;
    return output;
  };

  const buildLemmingSummaryCompact = (state, policy, options = {}) => {
    const summary = buildLemmingSummary(state, options);
    return {
      ...summary,
      selected: pruneLemming(summary.selected, policy),
      top: Array.isArray(summary.top) ? summary.top.map((lem) => pruneLemming(lem, policy)) : []
    };
  };

  const ensureGameFocus = async (session) => {
    await ensureBlurred(session);
  };

  const pressKey = async (session, key) => {
    const normalized = normalizeKeyChord(key);
    if (!normalized) return;
    await session.page.keyboard.press(normalized);
  };

  const pressAction = async (session, action, repeat = 1) => {
    const bindings = session.keybindings?.bindings || {};
    const chordList = bindings[action];
    if (!Array.isArray(chordList) || chordList.length === 0) {
      return { ok: false, reason: 'unknown_action' };
    }
    await ensureGameFocus(session);
    for (let i = 0; i < repeat; i += 1) {
      await pressKey(session, chordList[0]);
    }
    session.events.add({
      source: 'agent',
      type: 'input',
      summary: `action:${action} x${repeat}`
    });
    return { ok: true, action, repeat };
  };


  return {
    loadKeybindings,
    ensureBlurred,
    callE2E,
    getState,
    getTickIndex,
    filterStateSnapshot,
    buildSkillInfo,
    buildLemmingPrunePolicy,
    pruneLemming,
    buildLemmingSummaryCompact,
    ensureGameFocus,
    pressKey,
    pressAction
  };
};

export { createServerHelpers };
