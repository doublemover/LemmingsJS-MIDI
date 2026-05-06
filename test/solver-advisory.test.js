import { expect } from 'chai';
import {
  SOLVER_EXPLANATION_CODES,
  SOLVER_RESULT_TYPES,
  createSolverResult
} from '../js/solver/SolverTypes.js';
import {
  createFlatWalkFixture,
  createSmallGapFixture,
  createSyntheticSolverFixture
} from '../js/solver/SolverFixtures.js';
import {
  PROCGEN_FALLBACK_DECISIONS,
  PROCGEN_CHALLENGE_TYPES,
  createProcgenChallengeCertificate,
  decideProcgenFallback,
  verifyProcgenChallengeCertificate
} from '../js/solver/ProcgenCertificates.js';
import {
  EDITOR_ADVISORY_WARNING_CODES,
  checkEditorSolvabilityAdvisory
} from '../js/solver/EditorAdvisory.js';
import { SkillTypes } from '../js/game/SkillTypes.js';

describe('ProcgenCertificates', function() {
  it('verifies positive local chunks through a tactical solver', async function() {
    const chunk = createSmallGapFixture();
    const certificate = createProcgenChallengeCertificate({
      id: 'gap-bridge-1',
      challengeType: PROCGEN_CHALLENGE_TYPES.BRIDGE_GAP,
      expectedSkill: 'builder',
      assignmentWindow: { start: 18, end: 48 },
      expectedLandingSegment: { x0: 58, y0: 57, x1: 72, y1: 57 },
      expectedExitSegment: { x0: 116, y0: 57, x1: 126, y1: 57 },
      minimalSkillCount: 1
    });
    const verified = await verifyProcgenChallengeCertificate(certificate, chunk, {
      tacticalSolver({ certificate: receivedCertificate, chunk: receivedChunk }) {
        expect(receivedCertificate.expectedSkill).to.equal('builder');
        expect(receivedCertificate.roughAssignmentWindow).to.deep.equal({ start: 18, end: 48 });
        expect(receivedChunk.id).to.equal('small-gap');
        return createSolverResult({
          resultType: SOLVER_RESULT_TYPES.SOLVED,
          summary: 'small gap verified',
          actions: [{
            skill: 'builder',
            window: receivedCertificate.assignmentWindow,
            rationale: 'bridge the local procgen gap'
          }]
        });
      }
    });
    expect(verified.verificationResult.resultType).to.equal(SOLVER_RESULT_TYPES.SOLVED);
    expect(verified.verificationResult.actions[0].skillType).to.equal('builder');
    expect(decideProcgenFallback(verified.verificationResult).decision).to.equal(
      PROCGEN_FALLBACK_DECISIONS.ACCEPT
    );
  });

  it('returns unsupported instead of throwing when no tactical solver is available', async function() {
    const verified = await verifyProcgenChallengeCertificate({
      challengeType: PROCGEN_CHALLENGE_TYPES.BRIDGE_GAP,
      expectedSkill: 'builder'
    }, createSmallGapFixture(), {
      tacticalSolver: null
    });
    expect(verified.verificationResult.resultType).to.equal(SOLVER_RESULT_TYPES.UNSUPPORTED);
    expect(verified.verificationResult.explanations[0].code).to.equal(
      SOLVER_EXPLANATION_CODES.UNSUPPORTED_MECHANIC
    );
  });

  it('chooses simplify, replace, and extend fallbacks for failed chunks', function() {
    const simplify = decideProcgenFallback(createSolverResult({
      resultType: SOLVER_RESULT_TYPES.FAILED,
      explanations: [SOLVER_EXPLANATION_CODES.GAP_EXCEEDS_BUILDER_BUDGET]
    }));
    const replace = decideProcgenFallback(createSolverResult({
      resultType: SOLVER_RESULT_TYPES.FAILED,
      explanations: [SOLVER_EXPLANATION_CODES.HAZARD_UNAVOIDABLE]
    }));
    const extend = decideProcgenFallback(createSolverResult({
      resultType: SOLVER_RESULT_TYPES.FAILED,
      explanations: [SOLVER_EXPLANATION_CODES.MISSING_LANDING]
    }));
    expect(simplify.decision).to.equal(PROCGEN_FALLBACK_DECISIONS.SIMPLIFY);
    expect(replace.decision).to.equal(PROCGEN_FALLBACK_DECISIONS.REPLACE);
    expect(extend.decision).to.equal(PROCGEN_FALLBACK_DECISIONS.EXTEND);
  });
});

describe('EditorAdvisory', function() {
  it('returns non-blocking warnings for obvious advisory problems', function() {
    const gap = createSmallGapFixture({
      skills: {},
      oneWay: [{ x: 20, y: 58, width: 20, height: 4 }],
      hazards: [{ kind: 'teleporter', x: 64, y: 54, width: 8, height: 8 }]
    });
    const advisory = checkEditorSolvabilityAdvisory(gap);
    const codes = advisory.warnings.map(warning => warning.code);
    expect(advisory.canContinue).to.equal(true);
    expect(advisory.blocksEditing).to.equal(false);
    expect(advisory.blocksExport).to.equal(false);
    expect(codes).to.include(EDITOR_ADVISORY_WARNING_CODES.UNREACHABLE_GAP);
    expect(codes).to.include(EDITOR_ADVISORY_WARNING_CODES.INSUFFICIENT_SKILLS);
    expect(codes).to.include(EDITOR_ADVISORY_WARNING_CODES.UNSUPPORTED_MECHANIC);
  });

  it('warns about lethal drops without blocking editing or export', function() {
    const lethalDrop = createSyntheticSolverFixture({
      id: 'lethal-drop',
      width: 128,
      height: 128,
      ground: [
        { x: 0, y: 24, width: 42, height: 4 },
        { x: 58, y: 104, width: 70, height: 4 }
      ],
      entrances: [{ x: 8, y: 23 }],
      exits: [{ x: 112, y: 103 }],
      lemmings: [{ id: 0, x: 8, y: 23, lookRight: true, action: 'walking' }],
      skills: { builder: 4 }
    });
    const advisory = checkEditorSolvabilityAdvisory(lethalDrop);
    expect(advisory.blocksEditing).to.equal(false);
    expect(advisory.blocksExport).to.equal(false);
    expect(advisory.warnings.map(warning => warning.code)).to.include(
      EDITOR_ADVISORY_WARNING_CODES.LETHAL_DROP
    );
  });

  it('reads runtime skill arrays for advisory skill budgets', function() {
    const gap = createSmallGapFixture({ skills: {} });
    gap.skills = [];
    gap.skills[SkillTypes.BUILDER] = 2;

    const advisory = checkEditorSolvabilityAdvisory(gap);
    const codes = advisory.warnings.map(warning => warning.code);

    expect(codes).to.not.include(EDITOR_ADVISORY_WARNING_CODES.UNREACHABLE_GAP);
    expect(codes).to.not.include(EDITOR_ADVISORY_WARNING_CODES.INSUFFICIENT_SKILLS);
  });

  it('returns deterministic missing entrance and exit warnings', function() {
    const fixture = createFlatWalkFixture({
      entrances: [],
      exits: []
    });
    const first = checkEditorSolvabilityAdvisory(fixture);
    const second = checkEditorSolvabilityAdvisory(fixture);
    expect(first.warnings).to.deep.equal(second.warnings);
    expect(first.warnings.map(warning => warning.code).slice(0, 2)).to.deep.equal([
      EDITOR_ADVISORY_WARNING_CODES.MISSING_ENTRANCE,
      EDITOR_ADVISORY_WARNING_CODES.MISSING_EXIT
    ]);
    expect(first.canContinue).to.equal(true);
  });
});
