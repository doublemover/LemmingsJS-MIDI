/**
 * Build MCP state-tool handlers using injected schema/runtime dependencies.
 *
 * @param {{
 *   schemas: {
 *     StateGetSchema: { parse: (args?: object) => any },
 *     StateDeltaSchema: { parse: (args?: object) => any },
 *     LemmingsSummarySchema: { parse: (args?: object) => any }
 *   },
 *   attachEvents: (session: any, payload: any) => any,
 *   getSession: (sessionId: string) => any,
 *   callE2E: (session: any, method: string, ...args: any[]) => Promise<{ok:boolean,value?:any,error?:any}>,
 *   getState: (session: any) => Promise<any>,
 *   getTickIndex: (session: any) => Promise<number|null>,
 *   nudgeWatchPolling: (session: any) => void,
 *   helpers: {
 *     filterStateSnapshot: (state: any, include: object) => any,
 *     buildSkillInfo: (skills: any) => any,
 *     buildLemmingPrunePolicy: (state: any, skillInfo: any) => any,
 *     buildLemmingSummary: (state: any, options: object) => any,
 *     buildLemmingSummaryCompact: (state: any, policy: any, options: object) => any,
 *     pruneLemming: (lem: any, policy: any) => any
 *   },
 *   defaultLemDeltaFields: number[]
 * }} options
 * @returns {{
 *   getStateTool: (args?: object) => Promise<any>,
 *   getStateDeltaTool: (args?: object) => Promise<any>,
 *   getLemmingsSummaryTool: (args?: object) => Promise<any>
 * }}
 */
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

  const toTickInteger = (value, fallback = 0) => {
    if (!Number.isFinite(value)) return fallback;
    return Math.trunc(value);
  };

  const serializePayload = (payload, pretty = false) => {
    try {
      return {
        ok: true,
        json: JSON.stringify(payload, null, pretty ? 2 : 0)
      };
    } catch (error) {
      return {
        ok: false,
        error
      };
    }
  };

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
      const serialized = serializePayload(snapshot, format?.pretty);
      if (!serialized.ok) {
        return attachEvents(session, { ok: false, reason: 'snapshot_serialize_failed' });
      }
      const stored = session.resources?.put?.({
        sessionId: session.id,
        bytes: Buffer.from(serialized.json),
        mimeType: 'application/json',
        meta: { kind: 'state' }
      });
      if (!stored?.uri) {
        return attachEvents(session, { ok: false, reason: 'resource_store_failed' });
      }
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
      const serialized = serializePayload(snapshot, false);
      if (serialized.ok) {
        response.sizeBytesEstimate = Buffer.byteLength(serialized.json);
      }
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
      ? toTickInteger(afterTick, currentTick - 1)
      : toTickInteger(session.lastStateTick, currentTick - 1);
    const requestedTo = Number.isFinite(toTick) ? toTickInteger(toTick, currentTick) : currentTick;
    const effectiveTo = Math.min(currentTick, requestedTo);

    let startTick = Math.max(0, toTickInteger(effectiveAfter + 1, 0));
    let endTick = Math.max(0, toTickInteger(effectiveTo, 0));
    if (startTick > endTick) {
      const cursor = Math.max(endTick, toTickInteger(effectiveAfter, endTick));
      return attachEvents(session, {
        ok: true,
        cursor,
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
      const serialized = serializePayload(response, format?.pretty);
      if (!serialized.ok) {
        return attachEvents(session, { ok: false, reason: 'delta_serialize_failed' });
      }
      const stored = session.resources?.put?.({
        sessionId: session.id,
        bytes: Buffer.from(serialized.json),
        mimeType: 'application/json',
        meta: { kind: 'state-delta' }
      });
      if (!stored?.uri) {
        return attachEvents(session, { ok: false, reason: 'resource_store_failed' });
      }
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
