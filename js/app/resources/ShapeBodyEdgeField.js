import { verifyShapeBodyAsset, selectShapeBodyTier, shapeBodyFailure } from '../../midi/content/ShapeBodyAsset.js';
import { recheckElasticModes } from './ShapeBodyRefinement.js';
import { prepareEffectGraphRevision } from '../../midi/content/EffectGraphRevision.js';
import { freezeData, hashData } from '../../core/CanonicalData.js';
import { NETWORK_POINT_LOSS_OPERATOR } from '../../midi/content/SympatheticNetworkProfile.js';

export const SHAPE_BODY_EDGE_FIELD_REVISION = 'signed-solved-bar-edge-common-reference-v1';
export const SHAPE_BODY_SURFACE_FIELD_REVISION = 'signed-solved-bar-top-boundary-triangles-common-reference-v1';
export async function createShapeBodyEdgeField(raw, { fieldKind = 'edge', lossKind = 'diagonal', sampleRate = 48000, signal, current = () => true, yieldControl = () => new Promise(resolve => setTimeout(resolve, 0)) } = {}) {
  if (!['edge', 'surface'].includes(fieldKind)) shapeBodyFailure('Choose the exact solved edge or top-surface observation field.');
  if (!['diagonal', 'point'].includes(lossKind)) shapeBodyFailure('Choose the explicit diagonal approximation or signed point-loss model.');
  const surface = fieldKind === 'surface';
  const check = () => { signal?.throwIfAborted(); if (!current()) shapeBodyFailure('The solved edge field generation changed.'); }; check();
  const asset = await verifyShapeBodyAsset(raw); check();
  if (asset.id !== 'pocket-bar' || asset.source.revision !== 1 || asset.source.mesh.vertices.length !== 16) return freezeData({ state: 'unsupported', reason: 'This realization uses the original bar boundary only; no nearest-vertex substitution for another solid or refinement.', assetHash: asset.assetHash });
  const tier = selectShapeBodyTier(asset, { modeCount: 8, sampleRate }), modes = tier.modes;
  if (modes.some(mode => mode.frequencyHz > sampleRate * 0.2 || mode.t60Seconds < 0.075 || mode.t60Seconds > 4)) return freezeData({ state: 'unsupported', reason: 'The exact selected eight-mode tier exceeds the shared network frequency or decay domain. No retuning, mode substitution or decay clamping was applied.', assetHash: asset.assetHash });
  const algebraicEvidence = await recheckElasticModes(asset, check, yieldControl); check();
  const vertices = asset.source.mesh.vertices, edgeVertices = (surface ? [0, 0.3] : [0]).flatMap(y => [0, 1 / 3, 2 / 3, 1].map(x => vertices.findIndex(point => Math.abs(point[0] - x) < 1e-12 && Math.abs(point[1] - y) < 1e-12 && Math.abs(point[2] - 0.2) < 1e-12)));
  if (edgeVertices.some(index => index < 0) || new Set(edgeVertices).size !== (surface ? 8 : 4)) shapeBodyFailure('The exact solved bar boundary is absent.');
  for (let index = 0; index < 3; index++) if (!asset.source.mesh.tetrahedra.some(tet => tet.includes(edgeVertices[index]) && tet.includes(edgeVertices[index + 1]))) shapeBodyFailure('Pickup interpolation must follow actual connected Tet4 edges.');
  const triangles = [];
  if (surface) {
    const boundary = new Map(), faceKey = face => [...face].sort((a, b) => a - b).join(':');
    for (const tet of asset.source.mesh.tetrahedra) for (let omitted = 0; omitted < 4; omitted++) { const key = faceKey(tet.filter((_, index) => index !== omitted)); boundary.set(key, (boundary.get(key) || 0) + 1); }
    for (let cell = 0; cell < 3; cell++) triangles.push([edgeVertices[cell], edgeVertices[cell + 1], edgeVertices[cell + 5]], [edgeVertices[cell], edgeVertices[cell + 5], edgeVertices[cell + 4]]);
    if (triangles.some(face => boundary.get(faceKey(face)) !== 1)) shapeBodyFailure('The observation grid must follow the exact exposed Tet4 boundary triangles, including their diagonal.');
  }
  const rawPickup = edgeVertices.map(vertex => modes.map(mode => mode.displacementPerRootKg[vertex * 3 + 2]));
  const excitationVectors = asset.source.excitationSites.map((site, index) => modes.map(mode => mode.excitation[index]));
  const norm = vector => Math.hypot(...vector), pickupReference = Math.max(...rawPickup.map(norm)) * (1 + 1e-12), excitationReference = Math.max(...excitationVectors.map(norm)) * (1 + 1e-12);
  if (!(pickupReference > 1e-12) || !(excitationReference > 1e-12) || excitationVectors.some(vector => norm(vector) === 0)) shapeBodyFailure('The selected edge or strike sites have no supported signed response.');
  const row = rawPickup.flatMap(vector => vector.map(value => value / pickupReference)), weights = surface ? row : [...row, ...row];
  const receipt = freezeData({ schema: surface ? 'lemmings-shape-body-surface-field/v1' : 'lemmings-shape-body-edge-field/v1', revision: surface ? SHAPE_BODY_SURFACE_FIELD_REVISION : SHAPE_BODY_EDGE_FIELD_REVISION, sourceAssetHash: asset.assetHash, sourceHash: asset.sourceHash, meshHash: asset.meshHash, solver: asset.solver,
    sampleRate, modeIndices: tier.modeIndices, selectionPolicy: tier.selectionPolicy, retainedSalience01: tier.retainedSalience01, algebraicEvidence,
    vertexIndices: edgeVertices, positionsMeters: edgeVertices.map(vertex => vertices[vertex].map(value => value * asset.source.mesh.scaleMeters)), observationDirection: [0, 0, 1],
    ...(surface ? { triangleVertexIndices: triangles } : {}),
    field: { width: 4, height: 2, weights, xDomain: surface ? 'normalized-distance-along-solved-top-face' : 'normalized-distance-along-exact-connected-edge', yDomain: surface ? 'normalized-distance-across-solved-top-face' : 'intentionally-invariant;not-a-two-dimensional-surface', interpolation: surface ? 'piecewise-affine-on-actual-exposed-Tet4-triangles;lower-left-to-upper-right-diagonal' : 'piecewise-linear-on-actual-Tet4-edges;duplicated-y-row-for-existing-bilinear-renderer', pickupReference, normalization: surface ? 'one-maximum-L2-reference-over-all-surface-nodes;no-site-renormalization' : 'one-maximum-L2-reference-over-all-edge-nodes;no-site-renormalization' },
    strikeSites: asset.source.excitationSites, excitationVectors: excitationVectors.map(vector => vector.map(value => value / excitationReference)), excitationReference,
    excitationPolicy: 'signed-solved-site-projection;common-reference;bounded-first-order-complex-mode-audio-input;not-force-calibrated-second-order-elastic-response',
    lossPolicy: lossKind === 'point' ? 'positive-signed-rank-one-site-velocity-loss;normalized-complex-modal-split-flow;not-force-or-material-calibrated' : 'positive-diagonal-squared-site-projection-approximation;not-full-rank-one-point-damping', semanticOnsetsAdded: 0,
    qualification: { meshConvergence: 'not-qualified-by-this-field', acousticAccuracy: false, listening: false, deviceCost: false, effectRealization: 'shared-retained-eight-mode-audio-state;not-per-actor-resonators' } });
  const fieldHash = await hashData(receipt, { maxBytes: 262144, maxNodes: 16384 }); check();
  const bodyId = (surface ? 'shape-surface.' : 'shape-edge.') + asset.assetHash.slice(0, 16), gridId = (surface ? 'shape-surface-field.' : 'shape-edge-field.') + fieldHash.slice(0, 16), positions = { left: { x01: 0.15, y01: surface ? 0.2 : 0.5 }, right: { x01: 0.85, y01: surface ? 0.8 : 0.5 } };
  const lossMasks = receipt.excitationVectors.map((vector, index) => ({ id: 'shape-site-' + asset.source.excitationSites[index].id, ...(lossKind === 'point' ? { operator: NETWORK_POINT_LOSS_OPERATOR, velocityProjectionT60Seconds: 0.06 } : { extraAmplitudeT60Seconds: 0.06 }), weights: lossKind === 'point' ? vector : vector.map(value => value * value) }));
  const maps = asset.source.excitationSites.map((site, index) => {
    const node = (id, kind, parameters = {}) => ({ id, kind, parameters }), edge = (from, to) => ({ from: { nodeId: from, port: 'audio' }, to: { nodeId: to, port: 'audio' }, gain01: 1 });
    const parameters = { bodies: [{ id: bodyId, excitation01: 1, pickup01: 1, modes: modes.map(mode => ({ frequencyHz: mode.frequencyHz, decaySeconds: mode.t60Seconds / 1.5, gain01: 1 })) }], edges: [], couple01: 0, damp01: 0,
      excitationWeights: receipt.excitationVectors[index], excitationReferenceNorm: 1, lossMasks,
      pickupGrid: { id: gridId, width: 4, height: 2, weights, leftPosition: positions.left, rightPosition: positions.right, fieldRevision: surface ? 'solved-tet4-surface-v1' : 'solved-tet4-edge-v1', sourceAssetHash: asset.assetHash, sourceFieldHash: fieldHash } };
    const graph = prepareEffectGraphRevision({ schema: 'lemmings-effect-graph/v1', id: bodyId + '.' + site.id, revision: 1, latencyPolicy: 'align-declared', maximumLatencyFrames: 0, maximumTailSeconds: 15,
      nodes: [node('source', 'bus-in'), node('dry', 'gain', { gain01: 0.8, gainMaximum01: 1 }), node('excitation', 'sidechain-in', { sourceBusId: 'owner', tap: 'pre-fader', inputLayout: 'audioStereo' }),
        node('bodies', 'sympathetic-network', parameters), node('return', 'gain', { gain01: 0.2, gainMaximum01: 0.35 }), node('output', 'bus-out')],
      edges: [edge('source', 'dry'), edge('dry', 'output'), edge('excitation', 'bodies'), edge('bodies', 'return'), edge('return', 'output')] }, { sampleRate });
    return { schema: 'lemmings-sympathetic-map/v1', recipe: surface ? 'foundry-surface' : 'foundry-edge', graph: graph.definition, bodyIds: [bodyId], sourceBusId: 'owner', tap: 'pre-fader', siteId: site.id, lossMaskIds: lossMasks.map(mask => mask.id), pickupGridId: gridId, pickupPositions: positions,
      sourceAssetHash: asset.assetHash, fieldHash, modeIndices: tier.modeIndices, sourceRate: sampleRate, openModeT60Seconds: modes.map(mode => mode.t60Seconds), preparationMeaning: receipt.lossPolicy,
      causalPolicy: 'actual-selected-local-bus-excites-one-persistent-body;moving-pickup-only-observes-existing-state', qualification: receipt.qualification };
  });
  check(); return freezeData({ state: 'prepared', receipt, fieldHash, maps });
}
