const createGameRuntime = (game, performanceContext = null) => ({
  get history() {
    return game?.history ?? null;
  },
  get soundEvents() {
    return game?.soundEvents ?? null;
  },
  get miniMap() {
    return game?.lemmingManager?.miniMap ?? null;
  },
  get performanceContext() {
    return performanceContext ?? null;
  },
  get isReplayApplying() {
    return !!game?.timeTravel?.isReversing;
  }
});

const getRuntimeHistory = (runtime) => runtime?.history ?? null;
const getRuntimeSoundEvents = (runtime) => runtime?.soundEvents ?? null;
const getRuntimeMiniMap = (runtime) => runtime?.miniMap ?? null;
const getRuntimePerformanceContext = (runtime) => runtime?.performanceContext ?? null;
const isRuntimeReplayApplying = (runtime) => runtime?.isReplayApplying === true;

export {
  createGameRuntime,
  getRuntimeHistory,
  getRuntimeSoundEvents,
  getRuntimeMiniMap,
  getRuntimePerformanceContext,
  isRuntimeReplayApplying
};
