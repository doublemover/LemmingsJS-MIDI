import { expect } from 'chai';
import { causalRuntimeSourceVersions, sameCausalRuntimeProtocols, inspectCausalRuntimeExecution, describeCausalReperformance } from '../js/app/procgen/workstation/CausalRuntimeIdentity.js';

describe('captured causal application identity', () => {
  it('captures the actual unbuilt Node entry without accepting a caller build claim', () => {
    const captured = causalRuntimeSourceVersions({}, 2);
    expect(Object.isFrozen(captured)).to.equal(true); expect(Object.isFrozen(captured.applicationExecution)).to.equal(true);
    expect(captured.applicationExecution).to.include({ receiptVersion: 3, activeExecution: 'unbound', reason: 'unbuilt-source-entry', capabilityProfile: 'browser-survey-core' });
    expect(captured.applicationExecution).not.to.have.property('instrumentArtifacts');
    expect(inspectCausalRuntimeExecution(captured)).to.include({ status: 'unbound', exactQualified: false });
    expect(inspectCausalRuntimeExecution(captured).reasons).to.deep.equal(['recorded-execution-unbound', 'active-execution-unbound']);
    for (const args of [[null, 0], [{}, -1], [{}, 1.5], [{}, 0, 3]]) expect(() => causalRuntimeSourceVersions(...args)).to.throw('Unsupported current causal runtime');
  });
  it('compares every protocol field independently from optional build provenance', () => {
    const current = causalRuntimeSourceVersions({}, 1), legacy = { ...current }; delete legacy.applicationExecution;
    expect(sameCausalRuntimeProtocols(legacy, current)).to.equal(true);
    expect(sameCausalRuntimeProtocols({ ...current, applicationExecution: { buildId: 'forged' } }, current)).to.equal(true);
    for (const field of ['physicalMusic', 'mappingRevision', 'worldCheckpoint']) expect(sameCausalRuntimeProtocols({ ...current, [field]: current[field] + 1 }, current), field).to.equal(false);
    expect(sameCausalRuntimeProtocols({ ...current, futureProtocol: 1 }, current)).to.equal(false);
    expect(inspectCausalRuntimeExecution(legacy).reasons).to.include('legacy-recording-execution-unbound');
    expect(inspectCausalRuntimeExecution({ applicationExecution: { receiptVersion: 4 } })).to.include({ status: 'invalid' });
    expect(inspectCausalRuntimeExecution({ applicationExecution: { receiptVersion: 3, activeExecution: 'bound' } }).reasons).to.include('recorded-execution-identity-invalid');
  });
  it('explains protocol, asset and build differences without implying exact execution', () => {
    const positive = { compatibilityMatch: true, executionBinding: { status: 'matched' } };
    expect(describeCausalReperformance(positive)).to.include('recorded application build matches').and.include('remain unqualified');
    expect(describeCausalReperformance({ ...positive, executionBinding: { status: 'mismatched', mismatches: ['codeDigest'] } })).to.include('differs (codeDigest)');
    expect(describeCausalReperformance({ compatibilityMatch: true })).to.include('build is unqualified');
    expect(describeCausalReperformance({ reasons: ['source-version-mismatch', 'asset-identity-mismatch', 'unsupported-component-codec'] })).to.include('musical protocol differs').and.include('content hash differs').and.include('codec is unsupported');
    expect(describeCausalReperformance({ reasons: ['unknown-physical-source-coverage', 'incomplete-physical-source', 'causal-exact-realm-unqualified'] })).to.include('coverage is unknown').and.include('coverage is incomplete').and.include('isolated execution realm');
    expect(describeCausalReperformance({ failure: { message: 'Missing source record 4' } })).to.equal('Stored take comparison: Missing source record 4');
    expect(describeCausalReperformance(null)).to.equal('Stored take comparison: unavailable');
  });
});
