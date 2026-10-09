const PROCGEN_INTRO_SAFE_END = 256;
const PROCGEN_HAZARD_RAMP_END = 2048;
const progressionAt = worldX => {
  const difficulty = Math.max(0, Math.min(1, (worldX - PROCGEN_INTRO_SAFE_END) / (PROCGEN_HAZARD_RAMP_END - PROCGEN_INTRO_SAFE_END)));
  return { difficulty, safeIntro: worldX < PROCGEN_INTRO_SAFE_END, elevationRange: Math.floor(32 * difficulty),
    localRise: Math.floor(20 * difficulty), gapMaximum: 3 + Math.floor(9 * difficulty), hazardThreshold: 256 + Math.floor(768 * difficulty) };
};
export { PROCGEN_INTRO_SAFE_END, PROCGEN_HAZARD_RAMP_END, progressionAt };
