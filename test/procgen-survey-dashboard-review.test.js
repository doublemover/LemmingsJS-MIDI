import { expect } from 'chai';
import { surveyReviewOutcome, describeSurveyStep, describeSurveyStepSelection } from '../js/app/procgen/survey/ProcgenSurveyDashboard.js';

describe('survey evidence review labels', () => {
  it('does not turn surviving or arrived crews into a completed goal', () => {
    expect(surveyReviewOutcome({ status: 'timeout', episodeComplete: true, accounting: { alive: 8, deaths: 0 } }).outcome).to.equal('Goal not met at horizon');
    expect(surveyReviewOutcome({ status: 'completed', episodeComplete: false, accounting: { arrived: 8 } }).outcome).to.equal('Incomplete episode');
    expect(surveyReviewOutcome({ status: 'cancelled', episodeComplete: true }).outcome).to.equal('Outcome unknown');
  });
  it('keeps reported goal completion, deaths and unknown validity independent', () => {
    expect(surveyReviewOutcome({ status: 'completed', episodeComplete: true, accounting: { deaths: 1 } })).to.deep.equal({ outcome: 'Goal met at horizon', deaths: 1, validity: 'Validity unknown' });
    expect(surveyReviewOutcome({ accounting: { deaths: -1 } }).deaths).to.equal(null);
    expect(surveyReviewOutcome({}).deaths).to.equal(null);
  });
  it('requires every recorded validity gate, preserving failed gates over unknown ones', () => {
    const validity = { accountingComplete: true, deterministic: true, protectedTerrain: true, legitimateActions: true };
    expect(surveyReviewOutcome({ validity }).validity).to.equal('Validity checks passed');
    expect(surveyReviewOutcome({ validity: { ...validity, deterministic: null } }).validity).to.equal('Validity unknown');
    expect(surveyReviewOutcome({ validity: { protectedTerrain: false } }).validity).to.equal('Validity check failed');
  });
  it('labels queued, reached and unknown worker step outcomes without inventing checkpoint progress', () => {
    expect(describeSurveyStep({ queued: true })).to.include('queued');
    expect(describeSurveyStep({ stepReceipt: { status: 'pending', phase: 'preparing', expectedWorkers: 2 } })).to.include('no checkpoint confirmed');
    expect(describeSurveyStep({ stepReceipt: { status: 'reached', reachedCheckpoint: 64, selectedCount: 3 } })).to.include('tick 64');
    expect(describeSurveyStep({ stepReceipt: { status: 'timed-out', unacknowledgedWorkerCount: 1 } })).to.include('unconfirmed');
    expect(describeSurveyStep({ stepReceipt: { status: 'terminal-before-target', targetTick: 64 } })).to.include('before checkpoint');
    expect(describeSurveyStepSelection({ stepReceipt: { selectionComplete: false, selected: [{ trialId: 'trial-A', attemptId: 'attempt-1', status: 'unknown-progress', tick: 31 }] } }))
      .to.include('trial-A · attempt attempt-1 · unknown-progress · tick 31');
  });
});
