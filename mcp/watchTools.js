const createWatchToolHandlers = ({
  schemas,
  getSession,
  getState,
  attachEvents,
  makeId,
  readPointerValue,
  createPointerWatchState,
  updatePointerWatchState,
  buildLemmingSummary,
  captureFrame,
  pressAction,
  pressKey
}) => {
  const { EventsPollSchema, WatchCancelSchema, WatchCreateSchema } = schemas;

  const startWatchLoop = (session) => {
    session.watchController?.start();
  };
  
  const stopWatchLoop = (session) => {
    session.watchController?.stop();
  };
  
  const requestWatchPoll = (session, { immediate = false } = {}) => {
    session.watchController?.request({ immediate });
  };
  
  const nudgeWatchPolling = (session) => {
    if (!session?.watches?.size) return;
    requestWatchPoll(session, { immediate: true });
  };
  
  const pollWatches = async (session) => {
    if (!session.watches.size) return { triggeredCount: 0 };
    const state = await getState(session);
    if (!state) return { triggeredCount: 0 };
    const tickIndex = state.game?.timer?.tickIndex ?? null;
    let triggeredCount = 0;
    for (const watch of session.watches.values()) {
      if (!watch.enabled) continue;
      let triggered = false;
      if (watch.type === 'everyTicks') {
        if (Number.isFinite(tickIndex) && tickIndex - watch.lastTick >= watch.everyTicks) {
          watch.lastTick = tickIndex;
          triggered = true;
        }
      } else if (watch.type === 'onChange') {
        const pointerState = watch.pointerState || createPointerWatchState(watch.jsonPointer, state);
        watch.pointerState = pointerState;
        triggered = updatePointerWatchState(pointerState, state);
      }
  
      if (!triggered) continue;
      triggeredCount += 1;
      if (!Array.isArray(watch.actions) || !watch.actions.length) {
        session.events.add({
          source: 'system',
          type: 'watch-trigger',
          summary: `watch:${watch.id} triggered`,
          tickIndex
        });
        continue;
      }
  
      for (const action of watch.actions) {
        if (action.type === 'emitSummary') {
          const data = {};
          if (action.include?.lemmingsSummary) {
            data.lemmingsSummary = buildLemmingSummary(state, {});
          }
          if (Array.isArray(action.include?.statePointers)) {
            data.statePointers = {};
            for (const pointer of action.include.statePointers) {
              data.statePointers[pointer] = readPointerValue(state, pointer);
            }
          }
          session.events.add({
            source: 'system',
            type: 'watch-trigger',
            summary: `watch:${watch.id} summary`,
            tickIndex,
            data
          });
        } else if (action.type === 'capture') {
          const throttle = action.throttleTicks ?? 0;
          if (Number.isFinite(tickIndex) && throttle > 0 && tickIndex - watch.lastCaptureTick < throttle) {
            continue;
          }
          const captureOptions = action.capture || { target: 'page', delivery: 'resource' };
          const result = await captureFrame(session, captureOptions);
          if (result.ok && result.frame) {
            watch.lastCaptureTick = Number.isFinite(tickIndex) ? tickIndex : watch.lastCaptureTick;
            const event = {
              source: 'system',
              type: 'capture',
              summary: `watch:${watch.id} capture`,
              tickIndex
            };
            if (result.frame.resourceUri) {
              event.resourceUris = [result.frame.resourceUri];
            } else {
              event.data = { frame: result.frame };
            }
            session.events.add({
              ...event
            });
          } else {
            session.events.add({
              source: 'system',
              type: 'error',
              summary: `watch:${watch.id} capture failed`,
              tickIndex,
              data: { reason: result?.reason || 'capture_failed' }
            });
          }
        }
      }
    }
    return { triggeredCount };
  };
  

  const watchCreateTool = async (args) => {
    const { sessionId, watch, actions, enabled } = WatchCreateSchema.parse(args || {});
    const session = getSession(sessionId);
    const watchId = makeId();
    const state = watch.type === 'onChange' ? await getState(session) : null;
    const tickIndex = state?.game?.timer?.tickIndex ?? 0;
    const pointerState = watch.type === 'onChange'
      ? createPointerWatchState(watch.jsonPointer, state)
      : null;
  
    const entry = {
      id: watchId,
      type: watch.type,
      everyTicks: watch.everyTicks || 1,
      jsonPointer: watch.jsonPointer || '',
      enabled: enabled !== false,
      actions: actions || [],
      lastTick: Number.isFinite(tickIndex) ? tickIndex : 0,
      pointerState,
      lastCaptureTick: -Infinity
    };
  
    session.watches.set(watchId, entry);
    startWatchLoop(session);
    requestWatchPoll(session, { immediate: true });
  
    return attachEvents(session, {
      watchId,
      ok: true
    });
  };
  
  const watchCancelTool = async (args) => {
    const { sessionId, watchId } = WatchCancelSchema.parse(args || {});
    const session = getSession(sessionId);
    const ok = session.watches.delete(watchId);
    if (!session.watches.size) {
      stopWatchLoop(session);
    }
    return attachEvents(session, { ok });
  };
  
  const eventsPollTool = async (args) => {
    const { sessionId, after } = EventsPollSchema.parse(args || {});
    const session = getSession(sessionId);
    if (session.watches.size) {
      await session.watchController?.tickNow();
    }
    const normalizedAfter = session.events.normalizeCursor(after);
    const envelope = session.events.drain(normalizedAfter, { updateCursor: true });
    const cursor = String(envelope ? envelope.cursor : normalizedAfter);
    if (!envelope && session.watches.size) {
      requestWatchPoll(session, { immediate: true });
    }
    return envelope || { cursor, events: [] };
  };
  

  return {
    startWatchLoop,
    stopWatchLoop,
    requestWatchPoll,
    nudgeWatchPolling,
    pollWatches,
    watchCreateTool,
    watchCancelTool,
    eventsPollTool
  };
};

export { createWatchToolHandlers };
