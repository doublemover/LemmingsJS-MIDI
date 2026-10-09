import { qualifyProcgenRouteContract } from '../js/solver/ProcgenRouteQualification.js';
import { expect } from 'chai';
import { createProcgenRouteContract, validateProcgenRouteCatalogue, selectProcgenRouteContracts } from '../js/app/procgen/ProcgenRouteContracts.js';
import { verifyProcgenChallengeCertificateSync, verifyProcgenChallengeCertificate } from '../js/solver/ProcgenCertificates.js';
import { factoryFor } from './support/procgen-route-fixtures.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';

const wallContract = () => ({ schemaVersion: 1, id: 'contained-wide-wall', version: 1,
  source: { kind: 'repo-fixture', reference: 'test/support/procgen-route-fixtures.js', engine: 'LemmingsJS-MIDI', port: 'shared-classic-actions' },
  geometry: { bounds: { x: 8, y: 0, width: 248, height: 96 }, entry: { x: 24, y: 70, width: 40, height: 4 }, exit: { x: 180, y: 64, width: 32, height: 16 }, containment: [{ x: 12, y: 48, width: 1, height: 25 }, { x: 243, y: 48, width: 1, height: 25 }] },
  inventory: { builder: 0, basher: 1, digger: 0, miner: 0 }, crew: { min: 8, max: 16, direction: 1 },
  guards: ['ordinary-whole-crew', 'zero-loss', 'protected-terrain', 'revealed-geometry', 'solid-containment', 'no-hazard-contacts'],
  actionRules: [{ skill: 'basher', window: [0, 8], reason: 'Assign against the actual grounded wall before turning.' }],
  failureCases: ['Missing rear containment permits follower loss.', 'Steel or hazards invalidate the tunnel.', 'Inventory from separate runs cannot be combined.'] });

describe('complete procgen route contract catalogue qualification', function() {
  this.timeout(30000); let masks;
  before(async () => { masks = await loadProcgenMasks(); });
  it('qualifies actual whole-crew geometry from independent search and checks proposed timing rules against that result', () => {
    const record = wallContract();
    const result = qualifyProcgenRouteContract(record, factoryFor(masks, { wall: true, crewCount: 16 }), { maxActions: 1, maxNodes: 8 });
    expect(result.qualification).to.include({ status: 'engine-qualified', intendedRouteHint: false, wholeCrew: true, exitRescues: false });
    expect(result.verificationResult.actions[0].tick).to.equal(0); expect(result.verificationResult.replaySummary.protectedTerrainUnchanged).to.equal(true);
    expect(result.contract.source.reference).to.equal('test/support/procgen-route-fixtures.js');
    record.actionRules[0].window = [1000, 1008];
    expect(qualifyProcgenRouteContract(record, factoryFor(masks, { wall: true }), { maxActions: 1, maxNodes: 8 }).qualification.status).to.equal('unqualified');
  });
  it('rejects incomplete or invented joint inventories, excess action claims and duplicate catalogue identities', () => {
    const incomplete = wallContract(); delete incomplete.inventory.miner;
    expect(() => createProcgenRouteContract(incomplete)).to.throw('complete jointly feasible');
    const mixed = wallContract(); mixed.actionRules.push({ ...mixed.actionRules[0] });
    expect(() => createProcgenRouteContract(mixed)).to.throw('joint-inventory');
    expect(() => validateProcgenRouteCatalogue([wallContract(), wallContract()])).to.throw('Duplicate');
    expect(() => validateProcgenRouteCatalogue(Array(65).fill(wallContract()))).to.throw('Unbounded');
  });
  it('keeps protected or mismatched worlds unqualified even when catalogue metadata claims prior success', () => {
    const record = wallContract(); record.status = 'engine-qualified';
    const protectedWall = qualifyProcgenRouteContract(record, factoryFor(masks, { wall: true, steelWall: true }), { maxNodes: 4, maxTicks: 240 });
    expect(protectedWall.qualification.status).to.equal('unqualified');
    const missingInventory = qualifyProcgenRouteContract(record, factoryFor(masks, { wall: true, skills: { builder: 1 } }));
    expect(missingInventory.qualification.status).to.equal('unqualified'); expect(missingInventory.verificationResult.resultType).to.equal('unsupported');
  });
  it('selects transferred source records only for the exact original pack, ground and art revision', () => {
    const record = wallContract(), hash = 'a'.repeat(64);
    Object.assign(record.source, { kind: 'catalogue', pack: 'lemmings_ohNo', groundSet: 0, assetSha256: hash });
    const book = { routeContracts: [record] };
    expect(selectProcgenRouteContracts(book, { packPath: 'packs/lemmings_ohNo/', groundSet: 0, assetSha256: hash })).to.have.length(1);
    expect(selectProcgenRouteContracts(book, { packPath: 'lemmings', groundSet: 0, assetSha256: hash })).to.have.length(0);
    expect(selectProcgenRouteContracts(book, { packPath: 'lemmings_ohNo', groundSet: 1, assetSha256: hash })).to.have.length(0);
    expect(selectProcgenRouteContracts(book, { packPath: 'lemmings_ohNo', groundSet: 0, assetSha256: 'b'.repeat(64) })).to.have.length(0);
  });
  it('routes both existing certificate entrypoints through the real adapter when a complete contract is supplied', async () => {
    const source = { routeContract: wallContract() }, options = { procgenAdapterFactory: factoryFor(masks, { wall: true }), maxNodes: 8, maxActions: 1 };
    const sync = verifyProcgenChallengeCertificateSync({ id: 'whole-route' }, source, options), asyncResult = await verifyProcgenChallengeCertificate({ id: 'whole-route' }, source, options);
    expect(sync.verificationResult.resultType).to.equal('solved'); expect(asyncResult.verificationResult.resultType).to.equal('solved');
    expect(verifyProcgenChallengeCertificateSync({}, { routeContract: {} }, options).verificationResult.resultType).to.equal('unsupported');
    expect(sync.routeQualification.status).to.equal('engine-qualified'); expect(sync.verificationResult.replaySummary.goalReachedCount).to.equal(8);
  });
});