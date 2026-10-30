import { createFragmentQualificationCandidate, validatePhysicalScoreFragment, fragmentSignature } from '../app/procgen/workstation/PhysicalScoreFragment.js';
import { ProcgenSolverAdapter } from './ProcgenSolverAdapter.js';
import { qualifyProcgenRouteContract } from './ProcgenRouteQualification.js';
const inside = (point, bounds) => point.x >= bounds.x && point.x < bounds.x + bounds.width && point.y >= bounds.y && point.y < bounds.y + bounds.height;
export function qualifyPhysicalFragmentTransform(input, placement, cases, createAdapter, options = {}) {
  const fragment = validatePhysicalScoreFragment(input), transformed = createFragmentQualificationCandidate(fragment, placement);
  const original = createFragmentQualificationCandidate(fragment, { ...placement, namespace: 'qualification-original', transform: 'translate', x: fragment.pixelOrigin.x, y: fragment.pixelOrigin.y, parameters: {} });
  if (!Array.isArray(cases) || !cases.length || cases.length > 64 || typeof createAdapter !== 'function' || transformed.unresolved.some(ref => ref.required)) throw new Error('Fragment qualification requires bounded fully bound real-route cases.');
  const results = cases.map((sample, caseIndex) => {
    const run = (candidate, role, contract) => {
      const inletId = candidate.remapping.find(([key]) => key === `port:${sample.inletId}`)?.[1], outletId = candidate.remapping.find(([key]) => key === `port:${sample.outletId}`)?.[1];
      const inlet = candidate.ports.find(port => port.id === inletId), outlet = candidate.ports.find(port => port.id === outletId);
      if (!inlet || !outlet || inlet.role !== 'inlet' || outlet.role !== 'outlet' || !inside(inlet.position, contract?.geometry?.entry || {}) || !inside(outlet.position, contract?.geometry?.exit || {})) throw new Error('Fragment qualification does not bind the declared real ports.');
      let observedInput = null;
      const qualified = qualifyProcgenRouteContract(contract, () => {
        const adapter = createAdapter({ candidate, role, sample, caseIndex });
        try {
          if (!(adapter instanceof ProcgenSolverAdapter)) throw new Error('Fragment qualification requires the real procgen solver adapter.');
          const world = adapter.world, actors = world.actors.filter(actor => !actor.removed && !actor.failureReason && !actor.terminalReason && actor.action?.actionName !== 'blocking');
          if (actors.length < inlet.crew.min || actors.length > inlet.crew.max || actors.some(actor => !inlet.actions.includes(actor.action?.actionName) || !!actor.canClimb !== inlet.abilities.climb || !!actor.hasParachute !== inlet.abilities.parachute || inlet.direction !== 'either' && actor.lookRight !== (inlet.direction === 'right'))) throw new Error('Actual fragment inlet state is outside its declared envelope.');
          const positions = actors.map(actor => actor.x).sort((a, b) => a - b), spacing = positions.slice(1).map((x, index) => x - positions[index]);
          if (spacing.some(value => value < inlet.crew.minimumSpacingPixels || value > inlet.crew.maximumSpacingPixels)) throw new Error('Actual fragment crew spacing is unsupported.');
          for (const span of candidate.collision.spans) for (let x = span.x1; x < span.x2; x++) if (world.hasGroundAt(x, span.y) !== span.solid) throw new Error('Actual fragment geometry differs from its pinned candidate.');
          const hashes = (world.terrain?.themes || [{ terrain: world.terrain }]).map(({ terrain }) => terrain?.recipe?.assetSha256 ?? terrain?.sourceDescriptor?.sourceRevision);
          if (fragment.requiredAssets.some(hash => !hashes.includes(hash))) throw new Error('Actual fragment source fingerprint differs.');
          for (const port of [inlet, outlet]) for (const support of port.support) if (world.hasGroundAt(port.position.x + support.dx, port.position.y + support.dy) !== support.solid) throw new Error('Actual fragment port support differs.');
          observedInput = { crewSize: actors.length, spacingPixels: spacing, direction: actors[0]?.lookRight ? 'right' : 'left', actions: [...new Set(actors.map(actor => actor.action.actionName))], abilities: inlet.abilities };
          return adapter;
        } catch (error) { adapter?.dispose?.(); throw error; }
      }, { maxTicks: 4096, maxNodes: 128, ...options });
      return { observedInput, qualification: qualified.qualification, actualReplay: qualified.verificationResult };
    };
    const baseline = run(original, 'original', sample.originalContract), realized = run(transformed, 'realized', sample.realizedContract);
    const baselineTicks = baseline.actualReplay.replaySummary?.tick ?? null, realizedTicks = realized.actualReplay.replaySummary?.tick ?? null;
    return { caseIndex, inletId: sample.inletId, outletId: sample.outletId, baseline, realized,
      timing: { originalTicks: baselineTicks, realizedTicks, deltaTicks: Number.isFinite(baselineTicks) && Number.isFinite(realizedTicks) ? realizedTicks - baselineTicks : null, equivalenceAssumed: false } };
  });
  return { schema: 'physical-fragment-transform-qualification/v1', fragmentId: fragment.id, fragmentRevision: fragment.revision, fragmentSignature: fragmentSignature(fragment), sourceRevision: fragment.source.revision,
    transform: placement.transform ?? 'translate', placement: { x: placement.x, y: placement.y }, parameters: placement.parameters || {},
    status: results.every(result => [result.baseline, result.realized].every(run => run.qualification.status === 'engine-qualified')) ? 'qualified-tested-cases' : 'unqualified',
    claimsUntestedInputs: false, claimsAcousticQualification: false, results };
}
