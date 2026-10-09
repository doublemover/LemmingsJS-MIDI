const PROCGEN_INTRO_SAFE_END = 256;
const PROCGEN_HAZARD_RAMP_END = 2048;
const PROCGEN_RECOVERY_GAP_END = 1024;
const progressionAt = worldX => {
  const difficulty = Math.max(0, Math.min(1, (worldX - PROCGEN_INTRO_SAFE_END) / (PROCGEN_HAZARD_RAMP_END - PROCGEN_INTRO_SAFE_END)));
  return { difficulty, safeIntro: worldX < PROCGEN_INTRO_SAFE_END, elevationRange: Math.floor(32 * difficulty),
    localRise: Math.floor(20 * difficulty), gapDepth: worldX < PROCGEN_RECOVERY_GAP_END ? 4 + Math.floor(3 * Math.max(0, worldX - PROCGEN_INTRO_SAFE_END) / (PROCGEN_RECOVERY_GAP_END - PROCGEN_INTRO_SAFE_END)) : null, gapMaximum: 3 + Math.floor(9 * difficulty), hazardThreshold: 256 + Math.floor(768 * difficulty) };
};
export { PROCGEN_INTRO_SAFE_END, PROCGEN_HAZARD_RAMP_END, PROCGEN_RECOVERY_GAP_END, progressionAt };
