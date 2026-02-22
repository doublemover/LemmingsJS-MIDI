const createStateToolHandlers = ({
  schemas,
  attachEvents,
  getSession,
  callE2E,
  getState,
  getTickIndex,
  nudgeWatchPolling,
  helpers,
  defaultLemDeltaFields
}) => {
  const {
    filterStateSnapshot,
    buildSkillInfo,
    buildLemmingPrunePolicy,
    buildLemmingSummary,
    buildLemmingSummaryCompact,
    pruneLemming
  } = helpers;

  const getStateTool = async (args) => {
    const { sessionId, preset, include, lemmings, format } = schemas.StateGetSchema.parse(args || {});
    const session = getSession(sessionId);
    const raw = await getState(session);
    if (!raw) {
      return attachEvents(session, { ok: false, reason: 'harness_unavailable' });
    }

    const tickIndex = raw?.game?.timer?.tickIndex ?? null;
    if (Number.isFinite(tickIndex)) {
      session.lastStateTick = tickIndex;
    }

    const effectivePreset = preset || 'compact';
    const includeFlags = {
      view: false,
      stage: false,
      game: true,
      editor: false,
      midi: false,
      ...(include || {})
    };

    const skillInfo = raw.game ? buildSkillInfo(raw.game.skills) : null;
    const lemmingPolicy = raw.game ? buildLemmingPrunePolicy(raw, skillInfo) : null;

    let snapshot;
    if (effectivePreset === 'debug') {
      snapshot = filterStateSnapshot(raw, includeFlags);
      if (snapshot.game && skillInfo) {
        snapshot.game.skillsInfo = skillInfo;
      }
    } else {
      snapshot = {
        version: raw.version,
        mode: raw.mode,
        ready: raw.ready
      };
      if (includeFlags.view) snapshot.view = raw.view;
      if (includeFlags.stage) {
        snapshot.stage = raw.stage ? { viewRect: raw.stage.viewRect } : raw.stage;
      }
      if (includeFlags.game && raw.game) {
        snapshot.game = {
          state: raw.game.state ?? null,
          finalGameState: raw.game.finalGameState ?? null,
          timer: raw.game.timer ? {
            tickIndex: raw.game.timer.tickIndex,
            running: raw.game.timer.running,
            speedFactor: raw.game.timer.speedFactor
          } : null,
          victory: raw.game.victory ? {
            leftCount: raw.game.victory.leftCount,
            outCount: raw.game.victory.outCount,
            survivorCount: raw.game.victory.survivorCount,
            releaseRate: raw.game.victory.releaseRate,
            minReleaseRate: raw.game.victory.minReleaseRate,
            isFinalize: raw.game.victory.isFinalize
          } : null,
          level: raw.game.level ? {
            name: raw.game.level.name,
            width: raw.game.level.width,
            height: raw.game.level.height,
            releaseCount: raw.game.level.releaseCount,
            needCount: raw.game.level.needCount,
            timeLimit: raw.game.level.timeLimit,
            isSuperLemming: raw.game.level.isSuperLemming
          } : null,
          skills: skillInfo,
          lemmingManager: raw.game.lemmingManager ? {
            selectedIndex: raw.game.lemmingManager.selectedIndex,
            activeCount: raw.game.lemmingManager.activeCount,
            totalCount: raw.game.lemmingManager.totalCount,
            spawnTotal: raw.game.lemmingManager.spawnTotal,
            releaseTickIndex: raw.game.lemmingManager.releaseTickIndex,
            nukeTargets: raw.game.lemmingManager.nukeTargets
          } : null,
          lemmings: []
        };
      }
    }

    const lemmingOpts = lemmings || {};
    const mode = lemmingOpts.mode || 'summary';

    if (snapshot.game) {
      if (mode === 'none') {
        snapshot.game.lemmings = [];
      } else if (mode === 'summary') {
        snapshot.game.lemmings = [];
        const summary = effectivePreset === 'debug'
          ? buildLemmingSummary(raw, {
            activeOnly: lemmingOpts.activeOnly !== false,
            inViewOnly: !!lemmingOpts.inViewOnly,
            rectWorld: lemmingOpts.rectWorld,
            topK: lemmingOpts.topK,
            includeSelected: lemmingOpts.includeSelected
          })
          : buildLemmingSummaryCompact(raw, lemmingPolicy, {
            activeOnly: lemmingOpts.activeOnly !== false,
            inViewOnly: !!lemmingOpts.inViewOnly,
            rectWorld: lemmingOpts.rectWorld,
            topK: lemmingOpts.topK,
            includeSelected: lemmingOpts.includeSelected
          });
        snapshot.game.lemmingsSummary = summary;
      } else if (mode === 'selected') {
        snapshot.game.lemmings = [];
        const selectedIndex = raw?.game?.lemmingManager?.selectedIndex;
        const selected = Number.isFinite(selectedIndex) ? raw?.game?.lemmings?.[selectedIndex] : null;
        snapshot.game.selectedLemmingId = selected ? selected.id : null;
        snapshot.game.selectedLemming = effectivePreset === 'debug'
          ? selected
          : pruneLemming(selected, lemmingPolicy);
      } else if (mode === 'ids') {
        const ids = Array.isArray(lemmingOpts.ids) ? lemmingOpts.ids : [];
        snapshot.game.lemmingsIds = ids;
        snapshot.game.lemmings = ids.map((id) => {
          const lem = raw.game?.lemmings?.[id] || null;
          return effectivePreset === 'debug' ? lem : pruneLemming(lem, lemmingPolicy);
        });
      } else {
        const max = lemmingOpts.max || raw.game?.lemmings?.length || 0;
        const slice = raw.game?.lemmings?.slice(0, max) || [];
        snapshot.game.lemmings = effectivePreset === 'debug'
          ? slice
          : slice.map((lem) => pruneLemming(lem, lemmingPolicy));
      }
    }

    const delivery = format?.delivery || 'inline';
    if (delivery === 'resource') {
      const json = JSON.stringify(snapshot, null, format?.pretty ? 2 : 0);
      const stored = session.resources.put({
        sessionId: session.id,
        bytes: Buffer.from(json),
        mimeType: 'application/json',
        meta: { kind: 'state' }
      });
      return attachEvents(session, {
        ok: true,
        tickIndex,
        preset: effectivePreset,
        resourceUri: stored?.uri || null,
        sizeBytes: stored?.sizeBytes ?? null
      });
    }

    const response = {
      ok: true,
      tickIndex,
      preset: effectivePreset,
      snapshot
    };

    if (format?.includeSizeEstimate) {
      response.sizeBytesEstimate = Buffer.byteLength(JSON.stringify(snapshot));
    }

    return attachEvents(session, response);
  };

  const getStateDeltaTool = async (args) => {
    const { sessionId, afterTick, toTick, maxTicks, include, lemmings, format } = schemas.StateDeltaSchema.parse(args || {});
    const session = getSession(sessionId);
    const currentTick = await getTickIndex(session);
    if (!Number.isFinite(currentTick)) {
      return attachEvents(session, { ok: false, reason: 'tick_index_unavailable' });
    }

    const effectiveAfter = Number.isFinite(afterTick)
      ? afterTick
      : (Number.isFinite(session.lastStateTick) ? session.lastStateTick : (currentTick - 1));
    const effectiveTo = Number.isFinite(toTick) ? toTick : currentTick;

    let startTick = Math.trunc(effectiveAfter + 1);
    let endTick = Math.trunc(effectiveTo);
    if (startTick > endTick) {
      return attachEvents(session, {
        ok: true,
        cursor: endTick,
        afterTick: effectiveAfter,
        toTick: endTick,
        deltas: []
      });
    }

    const limit = Number.isFinite(maxTicks) ? Math.max(1, Math.trunc(maxTicks)) : 10;
    if ((endTick - startTick + 1) > limit) {
      startTick = endTick - limit + 1;
    }

    const inc = {
      lemmings: true,
      lemmingManager: true,
      skills: true,
      victory: true,
      timer: true,
      game: false,
      sound: false,
      minimap: false,
      triggers: false,
      objects: false,
      ground: false,
      entrances: false,
      ...(include || {})
    };

    const lemOpts = {
      fields: Array.isArray(lemmings?.fields) ? lemmings.fields : defaultLemDeltaFields,
      includePrev: lemmings?.includePrev === true,
      includeXY: lemmings?.includeXY || 'none',
      trackedIds: Array.isArray(lemmings?.trackedIds) ? lemmings.trackedIds : [],
      maxChanges: Number.isFinite(lemmings?.maxChanges) ? Math.max(1, Math.trunc(lemmings.maxChanges)) : 250
    };

    const fieldSet = new Set(lemOpts.fields);
    const trackedSet = new Set(lemOpts.trackedIds);

    const deltaRes = await callE2E(session, 'getDeltas', startTick, endTick, limit);
    if (!deltaRes.ok) {
      return attachEvents(session, { ok: false, reason: 'delta_unavailable', error: deltaRes.error || null });
    }
    const deltasRaw = Array.isArray(deltaRes.value) ? deltaRes.value : [];

    const filteredDeltas = [];
    for (const delta of deltasRaw) {
      if (!delta || typeof delta !== 'object') continue;
      const out = { tick: delta.tick };

      if (inc.lemmings) {
        const lemChanges = delta.lemChanges;
        if (lemChanges && Array.isArray(lemChanges.ids) && Array.isArray(lemChanges.fields) && Array.isArray(lemChanges.next)) {
          const ids = [];
          const fields = [];
          const next = [];
          const prev = [];

          for (let i = 0; i < lemChanges.ids.length; i += 1) {
            if (ids.length >= lemOpts.maxChanges) break;
            const id = lemChanges.ids[i];
            const field = lemChanges.fields[i];

            if (!fieldSet.has(field)) continue;
            if ((field === 0 || field === 1) && lemOpts.includeXY === 'none') continue;
            if ((field === 0 || field === 1) && lemOpts.includeXY === 'tracked' && !trackedSet.has(id)) continue;

            ids.push(id);
            fields.push(field);
            next.push(lemChanges.next[i]);
            if (lemOpts.includePrev && Array.isArray(lemChanges.prev)) {
              prev.push(lemChanges.prev[i]);
            }
          }

          if (ids.length > 0) {
            out.lemChanges = {
              ids,
              fields,
              ...(lemOpts.includePrev ? { prev } : {}),
              next
            };
          }
        }

        if (Array.isArray(delta.lemAdded) && delta.lemAdded.length > 0) {
          out.lemAddedIds = delta.lemAdded.map((lem) => lem?.id).filter((id) => Number.isFinite(id));
        }
        if (Array.isArray(delta.lemRemoved) && delta.lemRemoved.length > 0) {
          out.lemRemovedIds = delta.lemRemoved.map((lem) => lem?.id).filter((id) => Number.isFinite(id));
        }
      }

      if (inc.lemmingManager && delta.lemmingManagerChanges) out.lemmingManagerChanges = delta.lemmingManagerChanges;
      if (inc.skills && delta.skillsChanges) out.skillsChanges = delta.skillsChanges;
      if (inc.victory && delta.victoryChanges) out.victoryChanges = delta.victoryChanges;
      if (inc.timer && delta.timerChanges) out.timerChanges = delta.timerChanges;
      if (inc.game && delta.gameChanges) out.gameChanges = delta.gameChanges;

      if (inc.sound && Array.isArray(delta.soundEvents) && delta.soundEvents.length > 0) out.soundEvents = delta.soundEvents;
      if (inc.minimap && Array.isArray(delta.minimapDeaths) && delta.minimapDeaths.length > 0) out.minimapDeaths = delta.minimapDeaths;

      if (inc.triggers) {
        if (Array.isArray(delta.triggerCooldownChanges) && delta.triggerCooldownChanges.length > 0) {
          out.triggerCooldownChanges = delta.triggerCooldownChanges;
        }
        if (Array.isArray(delta.triggerAdd) && delta.triggerAdd.length > 0) out.triggerAdd = delta.triggerAdd;
        if (Array.isArray(delta.triggerRemove) && delta.triggerRemove.length > 0) out.triggerRemove = delta.triggerRemove;
      }

      if (inc.objects && Array.isArray(delta.objectAnimChanges) && delta.objectAnimChanges.length > 0) {
        out.objectAnimChanges = delta.objectAnimChanges;
      }
      if (inc.ground && delta.groundChanges) out.groundChanges = delta.groundChanges;
      if (inc.entrances && delta.entranceChanges) out.entranceChanges = delta.entranceChanges;

      filteredDeltas.push(out);
    }

    const response = {
      ok: true,
      cursor: endTick,
      afterTick: effectiveAfter,
      fromTick: startTick,
      toTick: endTick,
      deltas: filteredDeltas
    };

    const delivery = format?.delivery || 'inline';
    if (delivery === 'resource') {
      const json = JSON.stringify(response, null, format?.pretty ? 2 : 0);
      const stored = session.resources.put({
        sessionId: session.id,
        bytes: Buffer.from(json),
        mimeType: 'application/json',
        meta: { kind: 'state-delta' }
      });
      return attachEvents(session, {
        ok: true,
        cursor: endTick,
        resourceUri: stored?.uri || null,
        sizeBytes: stored?.sizeBytes ?? null
      });
    }

    return attachEvents(session, response);
  };

  const getLemmingsSummaryTool = async (args) => {
    const { sessionId, filter, topK, includeSelected } = schemas.LemmingsSummarySchema.parse(args || {});
    const session = getSession(sessionId);
    const state = await getState(session);
    if (!state) {
      return attachEvents(session, { ok: false, reason: 'harness_unavailable' });
    }
    const summary = buildLemmingSummary(state, {
      activeOnly: filter?.activeOnly !== false,
      inViewOnly: !!filter?.inViewOnly,
      rectWorld: filter?.rectWorld,
      topK,
      includeSelected
    });
    return attachEvents(session, summary);
  };

  return {
    getStateTool,
    getStateDeltaTool,
    getLemmingsSummaryTool
  };
};

export { createStateToolHandlers };
