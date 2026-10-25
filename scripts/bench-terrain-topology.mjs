import { performance } from 'node:perf_hooks';
import { analyzeTopology } from '../js/app/procgen/workstation/physical/TopologyInstrumentRegion.js';
const rows = [];
for (const side of [16, 64, 256]) {
  const region = { id: 'bounded-room', revision: 1, bounds: { x1: 0, y1: 0, x2: side, y2: side }, mapping: { revision: 1, bodyId: 'authored-modal-body', basePitchCents: 6000, referenceAreaPixels2: 64 } };
  const mask = Array.from({ length: (side + 2) ** 2 }, (_, index) => { const x = index % (side + 2) - 1, y = Math.floor(index / (side + 2)) - 1; return Number(x <= 0 || y <= 0 || x >= side - 1 || y >= side - 1); });
  const times = []; let previous = null;
  for (let iteration = 0; iteration < 64; iteration++) { const start = performance.now(); previous = analyzeTopology({ region, mask, worldId: 'profile', generation: 1, tick: iteration, sourceRevision: iteration }, previous); times.push(performance.now() - start); }
  times.sort((a, b) => a - b); rows.push({ areaPixels2: side * side, p50Ms: times[32], p95Ms: times[60], p99Ms: times[63], descriptorBytes: JSON.stringify(previous).length * 2, work: previous.work });
}
process.stdout.write(JSON.stringify({ scope: 'reference-topology-only-not-DSP-or-room-acoustics', rows }, null, 2) + '\n');
