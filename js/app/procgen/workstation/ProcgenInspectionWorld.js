import { GameFactory } from '../../../game/GameFactory.js';
import { GameTypes } from '../../../game/GameTypes.js';
import { ParticleTable } from '../../../render/ParticleTable.js';
import { ProcgenAssetManager } from '../../procgenAssetManager.js';
import { ProcgenLaneWorld } from '../ProcgenLaneWorld.js';
import { loadProcgenMixedTerrain } from '../ProcgenPackTerrain.js';
import { loadTerrainRecipeBook } from '../ProcgenTerrainRecipes.js';
import { createProcgenRetirementScope } from '../ProcgenRetirement.js';
import { estimateProcgenCandidateBytes } from '../ProcgenCandidateBudget.js';

const settleAll = async tasks => {
  const results = await Promise.allSettled(tasks), failures = results.filter(result => result.status === 'rejected');
  if (failures.length) throw failures.length === 1 ? failures[0].reason : new AggregateError(failures.map(result => result.reason), 'Inspection resources failed.');
  return results.map(result => result.value);
};

export async function prepareProcgenInspectionWorld({ checkpoint, rootPath, resourceBudget, signal } = {}) {
  if (checkpoint?.version !== 2 || checkpoint.generator !== 'procgen-workstation-1' || !Number.isSafeInteger(checkpoint.laneCount) || checkpoint.laneCount < 1 || checkpoint.laneCount > 1024 ||
      typeof rootPath !== 'string' || !resourceBudget?.reserve || !resourceBudget?.release || !Array.isArray(checkpoint.assets) || !checkpoint.assets.length)
    throw new TypeError('Inspection requires a current checkpoint, installed asset root and resource owner.');
  const maximumActors = checkpoint.graph?.owners?.find(owner => owner.name === 'world')?.props?.maxActors;
  if (!Number.isSafeInteger(maximumActors) || maximumActors < checkpoint.laneCount || maximumActors > 16384) throw new Error('Inspection actor capacity exceeds its admitted world tier.');
  signal?.throwIfAborted();
  const token = {}, actions = [], owners = createProcgenRetirementScope(), retirement = createProcgenRetirementScope(); let released = false, world = null;
  resourceBudget.reserve({ token, owner: 'causal-inspection-world', category: 'candidate', bytes: estimateProcgenCandidateBytes(checkpoint), pinned: true, reloadable: false });
  const dispose = () => retirement.retire([
    { name: 'world-and-assets', run: () => owners.retire([...actions].reverse()) },
    { name: 'world-reservation', run: async () => {
      const receipt = owners.getReceipt(); await receipt.completion;
      if (receipt.outcome !== 'complete') throw new Error('Inspection world ownership is unresolved.');
      if (!released) { released = true; const ack = resourceBudget.release({ token, owner: 'causal-inspection-world' });
        if (ack === false || ack && typeof ack.then === 'function') { if (ack?.then) Promise.resolve(ack).catch(() => {}); throw new Error('Inspection world reservation retirement is unresolved.'); } }
    } }
  ]);
  const check = () => signal?.throwIfAborted();
  try {
    const factory = new GameFactory(rootPath), provider = factory.fileProvider; provider.setBudgetAdapter?.(resourceBudget);
    actions.push({ name: 'provider', run: () => provider.dispose() });
    const providerLease = provider.acquireLease(); actions.push({ name: 'provider-consumer', run: () => providerLease.release() });
    let resources = null;
    const resourcesPromise = factory.getGameResources(GameTypes.LEMMINGS).then(value => { resources = value; actions.push({ name: 'game-resources', run: () => value.dispose?.() }); return value; });
    const [configs, , book] = await settleAll([
      settleAll([GameTypes.LEMMINGS, GameTypes.OHNO, GameTypes.HOLIDAY94].map(type => factory.getConfig(type))), resourcesPromise, loadTerrainRecipeBook(provider)
    ]); check();
    const assignments = checkpoint.terrainAssignments?.laneAssignments, requiredFamilies = checkpoint.assets.map(asset => asset.family);
    if (!assignments?.length) throw new Error('The checkpoint has no explicit lane terrain assignment.');
    const terrain = await loadProcgenMixedTerrain({ configs, fileProvider: provider, book, laneAssignments: assignments, requiredFamilies, signal });
    actions.push({ name: 'terrain', run: () => terrain.dispose() }); check();
    const displayAssets = new ProcgenAssetManager({ styleName: 'crystal', groundSet: 4, config: configs[0], fileProvider: provider });
    actions.push({ name: 'sprite-palette-source', run: () => displayAssets.dispose() }); await displayAssets.load({ signal }); check();
    const palette = displayAssets.assets?.gadgetImages?.find(image => image?.palette)?.palette || displayAssets.groundPieces[0].image.palette;
    const [sprites, masks] = await settleAll([resources.getLemmingsSprite(palette), resources.getMasks()]); check();
    world = new ProcgenLaneWorld({ laneCount: checkpoint.laneCount, laneHeight: checkpoint.laneHeight, seed: checkpoint.seed, sprites, masks, terrain,
      cohorts: true, workstation: true, speed: checkpoint.clock.speedFactor, particleTable: new ParticleTable(palette) });
    world.gameResources = resources; actions.push({ name: 'world', run: () => world.dispose() }); check();
    return Object.freeze({ world, dispose });
  } catch (error) {
    const receipt = dispose(); await receipt.completion; if (receipt.outcome !== 'complete') error.retirement = receipt; throw error;
  }
}
