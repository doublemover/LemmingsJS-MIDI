import { hashData, freezeData } from '../../../core/CanonicalData.js';
import { CIRCULAR_SPECTRUM_REVISION } from '../../../midi/content/CircularSpectrum.js';
import { createEmbeddedScenePatch } from './EmbeddedScenePatch.js';
import { validatePerformanceScene } from './PerformanceScene.js';

export async function createGlassOrbitCircularScores({ sourceHash, descriptor, scores, signal } = {}) {
  if (descriptor?.engineId !== 'worklet-spectrum' || descriptor.maximumVoices < 8) throw new TypeError('Circular Glass Orbit needs its exact phase-owned eight-voice spectrum source.');
  const macro = (id, name, parameter, unit, minimum, maximum, default01, direction) => ({ id, name, mode: 'onset-only', default01, smoothingMs: 0, perceptualDirection: direction,
    targets: [{ parameter, unit, minimum, maximum, curve: 'linear', composition: 'replace', clamp: true }] });
  const reference = await createEmbeddedScenePatch({ sourceHash, descriptor, definition: { schemaVersion: 2, id: 'scene.glass-orbit.circular-stones', revision: 1, name: 'Glass Orbit · circular stepping stones', author: 'LemmingsJS-MIDI', tags: ['original', 'scene', 'circular-spectrum', 'actual-pickup', 'unqualified-content'], engineId: 'worklet-spectrum', engineVersion: 1,
    parameters: { sourceMode: 2, circularControlMode: 3, circularScope: 0, circularAxis: 0, circularRequireSegments: 0, circularPeriodRatio: 2,
      circularReferenceHz: 55, circularCenterHz: 700, circularWidthOctaves: 1.2, circularLowHz: 80, circularHighHz: 8000, circularPartialCap: 10, circularWeight01: 1,
      circularPixelsPerCycle: 512, circularOriginPixels: 96, circularPhaseOrigin: 0, attackSeconds: 0.004, decaySeconds: 0.16, sustain01: 0, releaseSeconds: 0.25, gain01: 0.3, pan01: 0 },
    modulations: [], sampleRefs: [], causalBindings: [], voicePolicy: { maxVoices: 8, steal: 'reject' }, mix: { gain01: 0.3, pan01: 0 },
    macros: [macro('climb', 'CLIMB', 'circularPixelsPerCycle', 'world-pixel', 256, 1024, 1 / 3, 'More pixels per spectral cycle; the next actual gate samples its fixed world coordinate.'),
      macro('window', 'WINDOW', 'circularWidthOctaves', 'octaves', 0.5, 2, 7 / 15, 'Wider Gaussian amplitude envelope in log-frequency octaves on the next onset.'),
      macro('center', 'CENTER', 'circularCenterHz', 'Hz', 350, 1400, 1 / 3, 'Higher fixed spectral-envelope center; lattice reference stays55Hz before source-pitch transposition.'),
      macro('weight', 'WEIGHT', 'circularWeight01', 'ratio', 0, 1, 1, 'Larger bounded partial amplitude weight; zero produces silence, not an ordinary-tone fallback.')] } });
  const output = [];
  for (const base of scores) {
    signal?.throwIfAborted(); const original = base.scene, dependencies = [...base.dependencies, { kind: 'renderer', id: 'circular-spectrum-pickup', revision: 1,
        hash: await hashData({ buildId: sourceHash, revision: CIRCULAR_SPECTRUM_REVISION, policy: 'exact-observed-swept-gate-point;one-source-per-real-crossing;no-phase-clock' }),
        description: 'Owned octave circular partials sample the exact observed swept gate intersection. Each gate remains one physical onset with independent actor/source phase' }],
      scene = validatePerformanceScene({ ...original, id: original.id + '.circular-stones', title: original.title + ' · Circular stepping stones',
        description: 'The exact dry Glass Orbit terrain, entrants, five gate geometries, tuning and return junctions play octave circular-spectrum colors instead of FM glass. Each actual crossing samples its observed gate-intersection world-X coordinate. Phase is(x−96)/512cycles by default; movement between gates and empty time add no notes or hidden spectral ascent. Returning across the same gates reverses the color sequence. Every short gate voice retains its sampled phase while its oscillator carriers and finite release continue. The phase-owned lattice uses period2,55Hz reference before the original source-pitch transposition,700Hz Gaussian envelope center,1.2-octave amplitude width,80–8000Hz authored band and at most10partials with silent recycling guards. This is a stepping-stone comparison, not a continuous held riser or a promise of perceived endlessness. Exact original tuning still controls source transposition. CLIMB/WINDOW/CENTER/WEIGHT affect only later actual crossings and never move gates. Missing exact pickup evidence rejects that source. The dry FM scene remains the explicit ordinary comparison; no fallback changes synthesis silently.',
        physicalControls: [...original.physicalControls.filter(control => ['gate-spread', 'tuning'].includes(control.id)), ...['climb', 'window', 'center', 'weight'].map((id, index) => ({ id, label: ['CLIMB', 'WINDOW', 'CENTER', 'WEIGHT'][index], scope: 'sound', unit: 'normalized', minimum: 0, maximum: 1, initial: [1 / 3, 7 / 15, 1 / 3, 1][index], step: 0.01, target: 'patch-macro:' + id + ';next-onset-only' }))],
        patchRefs: original.patchRefs.map(patch => ({ laneId: patch.laneId, reference })), requirements: { ...original.requirements, required: dependencies }, cost: { ...original.cost, maximumVoices: 8 }, lessonLevel: 3,
        expectedLandmarks: [...original.expectedLandmarks, { id: 'circular-gate-coordinate', observationKind: 'PickupCrossing', sourceObjectId: original.causalMappings.pickups[0].id,
          consequence: 'The actual crossing pins gate revision, observation ID, source motion and fixed world coordinate into this one source’s spectral phase.', help: 'Compare the same complete physical take with dry glass. Inspect actual phase/frequency receipts and matched-level spectral output; perceived direction remains a separate listening result.' }],
        credits: [...original.credits, { name: 'LemmingsJS-MIDI', role: 'Original observed-gate octave circular-spectrum orchestration', source: null }] });
    output.push(freezeData({ ...base, scene, dependencies }));
  }
  return freezeData(output);
}
