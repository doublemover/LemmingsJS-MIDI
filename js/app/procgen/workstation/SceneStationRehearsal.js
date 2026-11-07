import { inspectSceneStationRehearsal } from './SceneStationPolicy.js';
import { createPhysicalFeedbackController } from './physical/PhysicalFeedback.js';
import { createOwnedResourceReservation } from '../../resources/OwnedResourceReservation.js';
import { createProcgenRetirementScope } from '../ProcgenRetirement.js';
import { canonicalDataText, freezeData } from '../../../core/CanonicalData.js';

export async function createSceneStationRehearsal({ scene, sceneHash, world, resourceBudget } = {}) {
  const profile = inspectSceneStationRehearsal(scene);
  if (!profile.available || world?.tickIndex !== 0 || world.activeCount !== 0 || world.interventionState.pending.length) throw new Error('Authored station rehearsal needs a cold private world with one-shot actor-bound skill stations.');
  const scope = createProcgenRetirementScope(), requests = [], outcomes = [], ids = new Set(); let workspace = null, controller = null, bytes = 0, fault = null;
  const retain = value => { const encoded = canonicalDataText(value, { maxBytes: 32768, maxNodes: 4096 }); if ((bytes += encoded.bytes.length) > 262144) throw new Error('Private station command receipts exceed their bounded source ledger.'); return freezeData(JSON.parse(encoded.text)); };
  const retire = () => {
    if (scope.getReceipt()) return scope.getReceipt();
    const stopped = Promise.resolve().then(async () => { if (!controller) return; const receipt = controller.dispose(); await receipt.completion; if (receipt.outcome !== 'complete') throw new Error('Private station controller retains unresolved ownership.'); });
    return scope.retire([{ name: 'private-station-controller', run: () => stopped }, { name: 'private-station-ledger', run: async () => { await stopped; workspace?.release(); requests.length = outcomes.length = 0; ids.clear(); } }]);
  };
  try {
    workspace = createOwnedResourceReservation({ budget: resourceBudget, owner: 'scene-station-rehearsal', kind: 'bounded-private-station-command-ledger', bytes: 4 * 1048576 });
    controller = createPhysicalFeedbackController({ world, resourceBudget, getGraph: () => scene.causalMappings, onFailure: error => { fault = error; }, recordInput: (input, boundary) => {
      if (input.commands.length + requests.length > profile.maximumRequests) throw new Error('A private station exceeded its finite one-request fuel.');
      for (let index = 0; index < input.commands.length; index++) { const command = input.commands[index]; if (ids.has(command.id)) throw new Error('Duplicate private station command identity.'); ids.add(command.id); requests.push(retain({ command, queued: input.outcomes[index], boundary })); }
      return { status: 'accepted' };
    } });
    controller.arm({ epoch: 'private-stations:' + sceneHash });
    return Object.freeze({
      observe(batch, analysis) { if (scope.getReceipt()) throw new Error('Private station ledger retired.'); for (const fact of batch.facts) if (ids.has(fact.commandId) && ['CommandApplied', 'CommandRejected'].includes(fact.kind)) { if (outcomes.length >= profile.maximumRequests || outcomes.some(row => row.commandId === fact.commandId)) throw new Error('Duplicate or oversized actual station command outcome.'); outcomes.push(retain({ commandId: fact.commandId, kind: fact.kind, tick: batch.tick, actorId: fact.actorId ?? null, reason: fact.reason ?? null })); } controller.observe(batch, analysis); if (fault) throw fault; },
      metadata() { if (scope.getReceipt()) throw new Error('Private station ledger retired.'); if (fault) throw fault; return freezeData({ schema: 'lemmings-private-scene-stations/v1', policy: profile.policy, sceneHash, maximumRequests: profile.maximumRequests, requests: [...requests], outcomes: [...outcomes], pendingAtPrefixEnd: world.interventionState.pending.filter(command => ids.has(command.id)).map(command => command.id), stopPolicy: 'cancel-pending-private-commands-at-prefix-end;no-later-source', liveWorldArmedByRehearsal: false, liveFeedbackChanged: false, historicalPerformanceEvidence: false }); },
      retire
    });
  } catch (error) { const receipt = retire(); await receipt.completion; if (receipt.outcome !== 'complete') error.retirement = receipt; throw error; }
}
