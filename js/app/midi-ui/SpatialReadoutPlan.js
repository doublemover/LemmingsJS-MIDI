import { createAcousticZoneRecipe } from '../../midi/content/AcousticZoneRecipes.js';
import { prepareEffectGraphRevision } from '../../midi/content/EffectGraphRevision.js';

export function spatialReadoutGraphCost(maps, sampleRate) {
  let graphBytes = 0, maximumTailFrames = 0;
  for (const map of maps) {
    const requested = new Set(map.controls.chamber01 > 0 ? map.zones.filter(zone => zone.enabled).flatMap(zone => zone.zoneSends.filter(send => send.amount01 > 0).map(send => send.returnId)) : []);
    for (const response of map.materialResponses) if (requested.has(response.id)) {
      const recipe = createAcousticZoneRecipe(response.effectRecipe.id, sampleRate, map.controls.absorb01);
      if (recipe.graph) { const plan = prepareEffectGraphRevision(recipe.graph, { sampleRate }); graphBytes += plan.stateBytes + plan.nativeNodeEstimateBytes + plan.impulseDecodedBytes * 6 + 1048576; maximumTailFrames = Math.max(maximumTailFrames, plan.maximumTailFrames); }
    }
  }
  return Object.freeze({ graphBytes, maximumTailFrames });
}
