import { hashData, freezeData } from '../../../core/CanonicalData.js';
import { createOriginalResonatorMorphProof } from '../../../midi/content/OriginalResonatorMorphProof.js';
import { createResonatorMorphMap } from '../../../midi/content/ResonatorMorph.js';
import { RESONATOR_BLEND_REVISION } from '../../../midi/content/ResonatorBlendProfile.js';
import { RESONATOR_MORPH_KERNEL_REVISION } from '../../../midi/content/PairedModalBodyProfile.js';
import { validateSceneMorphMechanism, sceneMorphMechanismCost } from './SceneMorphMechanism.js';
import { validatePerformanceSceneRecipe } from './PerformanceSceneRecipe.js';
import { validatePerformanceScene } from './PerformanceScene.js';

export async function createGlassOrbitMetamorphicScores({ sourceHash, scores, signal } = {}) {
  const proof = await createOriginalResonatorMorphProof(), output = [];
  for (const blend of [false, true]) {
    signal?.throwIfAborted();
    const map = blend ? await createResonatorMorphMap({ a: proof.a, b: proof.b, pairs: proof.map.pairs, siteCorrespondence: proof.map.siteCorrespondence, reviewed: true, transitionPolicy: 'prepared-dual-body-blend', id: 'original.glass-orbit.endpoint-blend' }) : proof.map;
    for (const base of scores) {
      signal?.throwIfAborted(); const original = base.scene, suffix = blend ? '.metamorphic-blend' : '.metamorphic-rail',
        mechanism = validateSceneMorphMechanism({ schema: 'lemmings-scene-morph-route/v3', instrumentId: original.causalMappings.instruments[0].id,
          controlSource: 'first-accepted-pickup-actor-signed-x', map, a: proof.a, b: proof.b, travelPixels: 512, wet01: 0.3 }), cost = sceneMorphMechanismCost(mechanism),
        recipe = validatePerformanceSceneRecipe({ ...base.recipe, id: base.recipe.id + suffix, initialMorphMechanism: mechanism }), recipeHash = await hashData(recipe),
        dependencies = [...base.dependencies, { kind: 'renderer', id: blend ? 'resonator-blend-body' : 'paired-modal-body', revision: 1,
          hash: await hashData({ buildId: sourceHash, revision: blend ? RESONATOR_BLEND_REVISION : RESONATOR_MORPH_KERNEL_REVISION }),
          description: blend ? 'Two independent prepared endpoint bodies; real first-gate actor travel controls only their convex readout' : 'One original reviewed correspondence body; real first-gate actor travel controls its retained paired modes' }],
        scene = validatePerformanceScene({ ...original, id: original.id + suffix, title: original.title + (blend ? ' · Metamorphic endpoint blend' : ' · Metamorphic rail'),
          worldRecipeRef: { id: recipe.id, revision: 1, hash: recipeHash },
          description: 'The original finite actors, five gates, terrain, return junctions and tuning stay identical. Only actual gate crossings attack the original FM glass source. The first accepted crossing of path one’s first gate binds that actor as the shared body controller. Its later observed signed world-X displacement, over512pixels from the completed binding position, drives MORPH; real return movement reverses the same coordinate. The short strike ending does not end actor control, and other actors keep their own source identities. Stops freeze the coordinate; termination, source gaps and teleports end control while retaining the known body tail. ' + (blend ? 'This explicit comparison prepares two independent endpoint bodies receiving the same owner audio, then changes their convex readout. It claims no intermediate physical object or correspondence-state transfer.' : 'This explicit correspondence experiment uses the reviewed original four-to-six-mode map in one retained synthetic body. It claims no measured material or physical terrain resonance.') + ' Enable local audio paused and wait for body readiness. Compare this scene with its named correspondence/blend partner using an unchanged physical recipe. No backend silently changes strategy. Body controls and their actual physical ancestry are captured independently of musical gate onsets; exact image restoration retains both the body and its actor-control owner. Matched-level listening and native qualification remain deferred.',
          expectedLandmarks: [...original.expectedLandmarks, { id: 'first-gate-actor-morph', observationKind: 'MotionCommitted', sourceObjectId: mechanism.instrumentId,
            consequence: 'The first admitted gate actor owns one bounded body-control attachment. Actual signed travel changes the retained body, while the original gate events remain the only musical attacks.',
            help: 'Observe the real return and compare corresponding source event IDs. A source gap or discontinuity freezes the last known control; no timer or replacement actor fills missing motion.' }],
          requirements: { ...original.requirements, required: dependencies }, cost: { ...original.cost, sharedBodies: cost.bodyCount }, lessonLevel: 3,
          credits: [...original.credits, { name: 'LemmingsJS-MIDI', role: blend ? 'Explicit original two-endpoint body comparison on unchanged Glass Orbit gates' : 'Original reviewed correspondence and observed gate-actor morph control', source: null }] });
      output.push(freezeData({ scene, recipe, recipeHash, dependencies }));
    }
  }
  return freezeData(output);
}
