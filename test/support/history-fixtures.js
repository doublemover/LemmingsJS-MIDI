const createStubTimer = () => ({
  tickIndex: 0,
  speedFactor: 1,
  frameTime: 60,
  onBeforeGameTick: { on() {}, off() {} },
  onGameTick: { on() {}, off() {} }
});

const recordTick = (history, timer, tickIndex, mutate, nextTick = tickIndex + 1) => {
  history.beginTick(tickIndex);
  if (mutate) mutate();
  if (timer) timer.tickIndex = nextTick;
  history.endTick();
};

const runHistoryOps = (history, ops) => {
  for (const [method, ...args] of ops) {
    history[method](...args);
  }
};

const scenario = (history, timer) => {
  const api = {
    tick(tickIndex, { ops = null, mutate = null, nextTick } = {}) {
      recordTick(history, timer, tickIndex, () => {
        if (ops && ops.length) runHistoryOps(history, ops);
        if (mutate) mutate();
      }, nextTick);
      return api;
    }
  };
  return api;
};

const seedHistory = (history, { deltas = [], keyframes = [] } = {}) => {
  for (const tick of deltas) {
    history._setDelta(tick, history._allocDelta(tick));
  }
  for (const tick of keyframes) {
    history._setKeyframe(tick, { tickIndex: tick });
  }
};

export { createStubTimer, recordTick, runHistoryOps, scenario, seedHistory };
