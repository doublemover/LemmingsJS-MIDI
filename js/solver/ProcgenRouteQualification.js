import { createProcgenRouteContract } from '../app/procgen/ProcgenRouteContracts.js';
import { searchProcgenGoal } from './ProcgenGoalSearch.js';
import { ProcgenSolverAdapter } from './ProcgenSolverAdapter.js';
import { createSolverResult } from './SolverTypes.js';

const INVENTORY_KEYS = ['builder', 'basher', 'digger', 'miner'];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const inside = (point, rect) => point.x >= rect.x && point.y >= rect.y && point.x < rect.x + rect.width && point.y < rect.y + rect.height;

const qualifyProcgenRouteContract = (record, createAdapter, options = {}) => {
  const contract = createProcgenRouteContract(record);
  let verificationResult;
  try {
    verificationResult = searchProcgenGoal(() => {
      const adapter = createAdapter();
      if (!(adapter instanceof ProcgenSolverAdapter)) throw new TypeError('Route qualification requires the real procgen adapter');
      try {
        if (!same(adapter.bounds, contract.geometry.bounds) || !same(adapter.goal, contract.geometry.exit) || !INVENTORY_KEYS.every(key => adapter.skills[key] === contract.inventory[key]) || adapter.crewCount < contract.crew.min || adapter.crewCount > contract.crew.max || adapter.initialActors.some(actor => !inside(actor, contract.geometry.entry) || actor.lookRight !== (contract.crew.direction === 1))) throw new Error('Actual route entry, goal, crew or complete inventory does not match the contract');
        if (contract.source.assetSha256 && (adapter.world.terrain?.recipe?.assetSha256 !== contract.source.assetSha256 || !adapter.world.terrain.recipe.sources?.some(source => source.pack === contract.source.pack && source.groundSet === contract.source.groundSet))) throw new Error('Route contract source art fingerprint does not match');
        if (contract.guards.includes('solid-containment')) for (const bound of contract.geometry.containment) for (let y = bound.y; y < bound.y + bound.height; y++) for (let x = bound.x; x < bound.x + bound.width; x++) if (!adapter.world.hasGroundAt(x, y)) throw new Error('Actual containment guard is missing');
        return adapter;
      } catch (error) { adapter.dispose(); throw error; }
    }, options);
    const summary = verificationResult.replaySummary;
    const actualActions = verificationResult.actions || [];
    const timingMatches = actualActions.length === contract.actionRules.length && actualActions.every((action, index) => {
      const rule = contract.actionRules[index]; return action.skillType === rule.skill && action.tick >= rule.window[0] && action.tick <= rule.window[1];
    });
    if (verificationResult.resultType === 'solved' && (!timingMatches || !summary?.protectedTerrainUnchanged || summary.routeBoundsExceeded || summary.deadCount !== 0 || summary.goalReachedCount !== summary.releaseCount || contract.guards.includes('no-hazard-contacts') && summary.hazardContacts !== 0)) {
      verificationResult = createSolverResult({ ...verificationResult, resultType: 'failed', summary: 'Actual whole-crew route guards failed', replaySummary: { ...summary, verified: false } });
    }
  } catch (error) {
    verificationResult = createSolverResult({ resultType: 'unsupported', summary: 'Route contract does not match a supported real initial world', explanations: [{ code: 'unsupported-mechanic', detail: error.message }] });
  }
  return { contract, verificationResult, qualification: Object.freeze({ status: verificationResult.resultType === 'solved' && verificationResult.replaySummary?.verified ? 'engine-qualified' : 'unqualified',
    engine: 'LemmingsJS-MIDI', goalKind: 'physical-region', exitRescues: false, source: contract.source, inventory: contract.inventory, wholeCrew: true, intendedRouteHint: false }) };
};
export { qualifyProcgenRouteContract };
