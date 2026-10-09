import { MAX_LOCAL_ROUTE_DISTANCE } from './ProcgenHazardPlanner.js';

const PROCGEN_INTRO_SAFE_END = 256;
const PROCGEN_HAZARD_RAMP_END = 2048;
const PROCGEN_RECOVERY_GAP_END = 1024;
const progressionAt = worldX => {
  const difficulty = Math.max(0, Math.min(1, (worldX - PROCGEN_INTRO_SAFE_END) / (PROCGEN_HAZARD_RAMP_END - PROCGEN_INTRO_SAFE_END)));
  return { difficulty, safeIntro: worldX < PROCGEN_INTRO_SAFE_END, elevationRange: Math.floor(32 * difficulty),
    localRise: Math.floor(20 * difficulty), gapDepth: worldX < PROCGEN_RECOVERY_GAP_END ? 4 + Math.floor(3 * Math.max(0, worldX - PROCGEN_INTRO_SAFE_END) / (PROCGEN_RECOVERY_GAP_END - PROCGEN_INTRO_SAFE_END)) : null, gapMaximum: 3 + Math.floor(9 * difficulty), hazardThreshold: 256 + Math.floor(768 * difficulty) };
};
// Conservative preparation-time admission, not route certification. Use actual
// transformed terrain alpha on the final foundation, never assembly boxes as
// collision. Wide overhead roofs remain ordinary walking terrain. A wall must
// expose the existing local tunnel end and eight-column continuation within 40px.
const introAssemblyEligible = ({ origin, left, right, surface, solid, steel = () => false, width = 128, height = 96 }) => {
  if (origin + left >= PROCGEN_RECOVERY_GAP_END) return true;
  let y = surface(left - 1);
  if (!Number.isInteger(y) || y < 0 || y >= height || !solid(left - 1, y)) return false;
  const step = (x, feet) => {
    let up = 0;
    while (up < 8 && solid(x, feet - up)) up++;
    if (up === 8) return null;
    if (up) return feet - up + 1;
    for (let at = feet + 1; at <= Math.min(feet + 12, height - 1); at++) if (solid(x, at)) return at;
    return null;
  };
  for (let x = left; x < right; x++) {
    const walked = step(x, y);
    if (walked != null) { y = walked; continue; }
    // Missing support is not a sourced local tunnel. Neither an unknown exit
    // nor a steel cut earns early eligibility from an assembly's provenance.
    let up = 0;
    while (up < 8 && solid(x, y - up)) up++;
    if (up !== 8) return false;
    let clear = 0, end = null;
    for (let at = x; at <= Math.min(x - 1 + MAX_LOCAL_ROUTE_DISTANCE - 9, width - 9); at++) {
      if (!solid(at, y + 1)) return false;
      for (let py = y - 9; py < y; py++) if (solid(at, py) && steel(at, py)) return false;
      clear = solid(at, y - 6) ? 0 : clear + 1;
      if (clear >= 4) { end = at; break; }
    }
    if (end == null) return false;
    for (let at = end + 1; at <= end + 9; at++) {
      if (at >= width) return false;
      const next = step(at, y); if (next == null) return false;
      y = next;
    }
    x = end + 9;
  }
  return true;
};
export { PROCGEN_INTRO_SAFE_END, PROCGEN_HAZARD_RAMP_END, PROCGEN_RECOVERY_GAP_END, progressionAt, introAssemblyEligible };
