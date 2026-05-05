const createGameToolHandlers = ({
  schemas,
  getSession,
  getState,
  getTickIndex,
  callE2E,
  attachEvents,
  nudgeWatchPolling,
  ensureGameFocus,
  pressAction,
  pressKey,
  normalizeKeyToken,
  skillActions,
  skillIndexByName
}) => {
  const {
    InputActionSchema,
    InputKeysSchema,
    LemmingSelectSchema,
    SkillApplySchema,
    TimeSchema,
    TimeStepSchema
  } = schemas;
  const SKILL_ACTIONS = skillActions;
  const SKILL_INDEX_BY_NAME = skillIndexByName;

  const pauseTime = async (args) => {
    const { sessionId } = TimeSchema.parse(args || {});
    const session = getSession(sessionId);
    const result = await callE2E(session, 'pause');
    if (result.ok && result.value) {
      nudgeWatchPolling(session);
    }
    const tickIndex = await getTickIndex(session);
    return attachEvents(session, {
      ok: !!result.ok && !!result.value,
      tickIndex
    });
  };
  
  const resumeTime = async (args) => {
    const { sessionId } = TimeSchema.parse(args || {});
    const session = getSession(sessionId);
    const result = await callE2E(session, 'resume');
    if (result.ok && result.value) {
      nudgeWatchPolling(session);
    }
    const tickIndex = await getTickIndex(session);
    return attachEvents(session, {
      ok: !!result.ok && !!result.value,
      tickIndex
    });
  };
  
  const stepTime = async (args) => {
    const { sessionId, count, ensurePaused } = TimeStepSchema.parse(args || {});
    const session = getSession(sessionId);
    if (ensurePaused !== false) {
      await callE2E(session, 'pause');
    }
    const tickIndexBefore = await getTickIndex(session);
    const result = await callE2E(session, 'step', count);
    if (result.ok && result.value) {
      nudgeWatchPolling(session);
    }
    const tickIndexAfter = await getTickIndex(session);
    return attachEvents(session, {
      ok: !!result.ok && !!result.value,
      tickIndexBefore,
      tickIndexAfter
    });
  };
  

  const centerViewOnLemming = async (session, lemmingId) => {
    const result = await callE2E(session, 'centerViewOnLemming', lemmingId);
    return !!(result.ok && result.value);
  };
  
  const selectLemmingTool = async (args) => {
    const { sessionId, lemmingId, alsoCenterView, confirm } = LemmingSelectSchema.parse(args || {});
    const session = getSession(sessionId);
    const result = await callE2E(session, 'selectLemmingById', lemmingId);
    if (!result.ok || !result.value) {
      const state = await getState(session);
      const entry = state?.game?.lemmings?.[lemmingId] || null;
      let reason = 'harness_unavailable';
      if (entry) {
        if (entry.removed) reason = 'removed';
        else if (entry.disabled) reason = 'disabled';
        else reason = 'not_found';
      } else {
        reason = 'not_found';
      }
      return attachEvents(session, {
        ok: false,
        lemmingId,
        reason
      });
    }
  
    if (alsoCenterView) {
      await centerViewOnLemming(session, lemmingId);
    }
    nudgeWatchPolling(session);
  
    let selectedNow = null;
    if (confirm !== false) {
      const state = await getState(session);
      selectedNow = state?.game?.lemmingManager?.selectedIndex ?? null;
    }
  
    return attachEvents(session, {
      ok: true,
      lemmingId,
      selectedNow
    });
  };
  
  const applySkillTool = async (args) => {
    const { sessionId, skill, lemmingId, ensurePaused, requireAvailable, postStep, verify } =
      SkillApplySchema.parse(args || {});
    const session = getSession(sessionId);
    if (ensurePaused !== false) {
      await callE2E(session, 'pause');
    }
  
    let tickIndexBefore = null;
    let tickIndexAfter = null;
    let beforeState = null;
    if (verify !== false || requireAvailable) {
      beforeState = await getState(session);
      tickIndexBefore = beforeState?.game?.timer?.tickIndex ?? null;
    }
  
    const action = SKILL_ACTIONS[skill];
    if (!action) {
      return attachEvents(session, { ok: false, reason: 'unknown_skill', skill });
    }
  
    if (requireAvailable) {
      const skills = beforeState?.game?.skills || null;
      const skillIndex = SKILL_INDEX_BY_NAME[skill];
      const available = !!skills?.cheatMode || (Number.isFinite(skillIndex)
        && Array.isArray(skills?.skills)
        && skills.skills[skillIndex] > 0);
      if (!available) {
        return attachEvents(session, { ok: false, reason: 'no_skill_remaining', skill });
      }
    }
  
    if (Number.isFinite(lemmingId)) {
      const selectResult = await callE2E(session, 'selectLemmingById', lemmingId);
      if (!selectResult.ok || !selectResult.value) {
        return attachEvents(session, {
          ok: false,
          skill,
          lemmingIdAppliedTo: lemmingId,
          reason: 'select_failed'
        });
      }
    }
  
    const selectKey = await pressAction(session, action, 1);
    if (!selectKey.ok) {
      return attachEvents(session, { ok: false, reason: 'missing_binding', skill, action });
    }
    const applyKey = await pressAction(session, 'applySkillToSelected', 1);
    if (!applyKey.ok) {
      return attachEvents(session, { ok: false, reason: 'missing_binding', action: 'applySkillToSelected' });
    }
  
    const steps = Number.isFinite(postStep) ? Math.trunc(postStep) : 1;
    if (steps > 0) {
      await callE2E(session, 'step', steps);
    }
  
    let verification = null;
    let lemmingIdAppliedTo = lemmingId ?? null;
    if (verify !== false) {
      const afterState = await getState(session);
      tickIndexAfter = afterState?.game?.timer?.tickIndex ?? null;
      const selectedId = afterState?.game?.lemmingManager?.selectedIndex ?? null;
      lemmingIdAppliedTo = Number.isFinite(lemmingIdAppliedTo) ? lemmingIdAppliedTo : selectedId;
      const beforeLem = lemmingIdAppliedTo != null
        ? beforeState?.game?.lemmings?.[lemmingIdAppliedTo] || null
        : null;
      const afterLem = lemmingIdAppliedTo != null
        ? afterState?.game?.lemmings?.[lemmingIdAppliedTo] || null
        : null;
      const changedFields = [];
      let applied = false;
      if (beforeLem && afterLem) {
        if (skill === 'climber' && !beforeLem.canClimb && afterLem.canClimb) {
          applied = true;
          changedFields.push('canClimb');
        } else if (skill === 'floater' && !beforeLem.hasParachute && afterLem.hasParachute) {
          applied = true;
          changedFields.push('hasParachute');
        } else if (skill === 'bomber' && !beforeLem.countdownActive && afterLem.countdownActive) {
          applied = true;
          changedFields.push('countdownActive');
        } else if (beforeLem.actionType !== afterLem.actionType) {
          applied = true;
          changedFields.push('actionType');
        }
      }
      verification = {
        applied,
        changedFields
      };
    }
  
    nudgeWatchPolling(session);
    return attachEvents(session, {
      ok: true,
      skill,
      lemmingIdAppliedTo,
      tickIndexBefore,
      tickIndexAfter,
      verification
    });
  };
  
  const inputActionTool = async (args) => {
    const { sessionId, action, repeat } = InputActionSchema.parse(args || {});
    const session = getSession(sessionId);
    const response = await pressAction(session, action, repeat || 1);
    if (response.ok) {
      nudgeWatchPolling(session);
    }
    return attachEvents(session, response);
  };
  
  const inputKeysTool = async (args) => {
    const { sessionId, keys, repeat, events } = InputKeysSchema.parse(args || {});
    const session = getSession(sessionId);
    await ensureGameFocus(session);
    let injected = 0;
  
    if (Array.isArray(keys) && keys.length) {
      const count = repeat || 1;
      for (let i = 0; i < count; i += 1) {
        for (const key of keys) {
          await pressKey(session, key);
          injected += 1;
        }
      }
    } else if (Array.isArray(events)) {
      for (const event of events) {
        const key = normalizeKeyToken(event.key);
        if (event.type === 'down') {
          await session.page.keyboard.down(key);
        } else if (event.type === 'up') {
          await session.page.keyboard.up(key);
        } else {
          await session.page.keyboard.press(key);
        }
        injected += 1;
      }
    }
  
    if (injected) {
      session.events.add({
        source: 'agent',
        type: 'input',
        summary: `keys:${injected}`
      });
      nudgeWatchPolling(session);
    }
  
    return attachEvents(session, { ok: true, eventsInjected: injected });
  };
  

  return {
    pauseTime,
    resumeTime,
    stepTime,
    selectLemmingTool,
    applySkillTool,
    inputActionTool,
    inputKeysTool
  };
};

export { createGameToolHandlers };
