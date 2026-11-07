import { loadProcgenMasks } from './bench-procgen-lanes.js';
import { replayPhysicalFragmentCircuit } from '../test/support/physical-fragment-circuit.js';
const masks = await loadProcgenMasks();
const cases = [{}, { translation: 100 }, { reflection: true }, { scale: 2 }].map(options => replayPhysicalFragmentCircuit(masks, options));
const complete = cases.every(result => result.actor.action === 'walk' && !result.actor.failureReason && !result.actor.terminalReason && result.periodsTicks.length >= 2);
console.log(JSON.stringify({ schema: 'physical-fragment-transform-fixture/v1', status: complete ? 'observed-tested-cases' : 'incomplete', cases,
  historicalReferenceOnly: { originalPeriodTicks: 120, reflectedPeriodTicks: 120, doubledGeometryPeriodTicks: 242 },
  anyFragmentQualified: false, claimsAcousticQualification: false }, null, 2));
if (!complete) process.exitCode = 1;
