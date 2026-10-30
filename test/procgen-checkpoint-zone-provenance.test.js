import { expect } from 'chai';
import { CHECKPOINT_COMPONENT_CODECS } from '../js/app/procgen/workstation/ProcgenCheckpoint.js';
import { projectProcgenPhysicsCheckpoint, hashProcgenPhysicsCheckpoint } from '../js/app/procgen/workstation/ProcgenCheckpointProvenance.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
import { checkpointContinuationCorpus } from './helpers/checkpointContinuationCorpus.js';

const fixture = ({ split = false, change = null } = {}) => {
  const zone = { type: 'Object', props: { id: 'zone-model:42:0', index: 0, start: 0, end: 512, width: 512, maximumAuthoredWidth: 1600,
    descriptorId: 'zone-model', sourceRevision: 'a'.repeat(64), pack: 'model', groundSet: 1, themeId: 'model-1',
    anchorPair: { external: 'asset/0/sourceDescriptor/assetPairs/0' }, groups: { ref: 2 } } };
  const groups = { type: 'Array', props: {}, values: [{ external: 'asset/0/sourceDescriptor/groups/0' }] };
  const nodes = [{ type: 'Array', props: {}, values: [{ ref: 1 }, { ref: split ? 3 : 1 }] }, zone, groups];
  if (split) { const second = structuredClone(zone); second.props.groups.ref = 4; nodes.push(second, structuredClone(groups)); }
  change?.(nodes);
  return { version: 2, schema: 'lemmings-procgen-checkpoint', generator: 'procgen-workstation-2', numericEncoding: 'typed-f64-sentinels-v2',
    componentCodecs: { ...CHECKPOINT_COMPONENT_CODECS }, physicsAlgorithms: { causalRandom: 'fnv1a32-avalanche-v1', populationRandom: 1, terrainChallenge: 3, stallCascade: 2 },
    seed: 42, laneCount: 1, laneHeight: 96, assets: [{ family: 'model', id: 'zone-model', revision: 'a'.repeat(64) }],
    graph: { nodes, owners: [{ name: 'world', props: { zoneProjectionFixture: { ref: 0 } } }] },
    clock: { speedFactor: 0, simulationTimeMs: 120 } };
};

describe('source-bound terrain zone value identity in physics projection', () => {
  it('separates simulation display identity from complete checkpoint continuation and refuses pending analysis', async () => {
    const masks = await loadProcgenMasks(), result = await checkpointContinuationCorpus(() => new ProcgenLaneWorld({ masks, assists: false }));
    expect(result.map(row => row.kind)).to.deep.equal(['physicalAuthoring', 'terrainTopology', 'crew-prerequisite', 'assistance-and-delivery', 'comparison-scope', 'pending-topology']);
  });
  it('normalizes equal source-zone copies without mutating the captured graph', async () => {
    const shared = fixture(), split = fixture({ split: true }), original = structuredClone(split);
    expect(projectProcgenPhysicsCheckpoint(split)).to.deep.equal(projectProcgenPhysicsCheckpoint(shared));
    expect(await hashProcgenPhysicsCheckpoint(split)).to.equal(await hashProcgenPhysicsCheckpoint(shared));
    expect(split).to.deep.equal(original);
  });
  it('preserves changed geometry, source revision, group and anchor identities', async () => {
    const baseline = await hashProcgenPhysicsCheckpoint(fixture());
    for (const change of [nodes => { nodes[3].props.width = nodes[3].props.end = 640; },
      nodes => { nodes[3].props.sourceRevision = 'b'.repeat(64); }, nodes => { nodes[4].values[0].external = 'asset/0/sourceDescriptor/groups/1'; },
      nodes => { nodes[3].props.anchorPair.external = 'asset/0/sourceDescriptor/assetPairs/1'; }]) {
      expect(await hashProcgenPhysicsCheckpoint(fixture({ split: true, change }))).not.to.equal(baseline);
    }
  });
  it('retains alias identity for mutable objects and zones with unknown state fields', async () => {
    for (const change of [nodes => { for (const node of nodes) if (node.type === 'Object') node.props = { count: 3 }; },
      nodes => { for (const node of nodes) if (node.type === 'Object') node.props.mutableState = 0; }]) {
      expect(await hashProcgenPhysicsCheckpoint(fixture({ change }))).not.to.equal(await hashProcgenPhysicsCheckpoint(fixture({ split: true, change })));
    }
  });
  it('does not intern undeclared group nodes or foreign asset namespaces', async () => {
    for (const change of [nodes => { for (const node of nodes) if (node.type === 'Array' && node.values[0]?.external) node.values[0] = 1; },
      nodes => { for (const node of nodes) if (node.type === 'Array' && node.values[0]?.external) node.values[0].external = 'unbound/groups/0'; }]) {
      expect(await hashProcgenPhysicsCheckpoint(fixture({ change }))).not.to.equal(await hashProcgenPhysicsCheckpoint(fixture({ split: true, change })));
    }
  });
  it('keeps malformed references and unknown node state visible to validation', () => {
    const invalid = fixture({ split: true, change: nodes => { nodes[3].props.groups.ref = '2'; } });
    expect(() => projectProcgenPhysicsCheckpoint(invalid)).to.throw('Invalid physical checkpoint reference');
    const extra = fixture({ split: true, change: nodes => { nodes[3].unknownState = 1; } });
    expect(projectProcgenPhysicsCheckpoint(extra)).not.to.deep.equal(projectProcgenPhysicsCheckpoint(fixture()));
  });
});
