/** @param {unknown} value */
const integer = value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
/** @param {unknown} value */
const bounded = (value, length = 120) => typeof value === 'string' && value.length <= length ? value : null;
/** @param {unknown} value @returns {Record<string, unknown>} */
const record = value => value && typeof value === 'object' ? /** @type {Record<string, unknown>} */ (value) : {};
/** @param {unknown} value @returns {import('./ProcgenBoundaryContracts.js').ProjectTickBoundary | null} */
const boundary = value => { const raw = record(value), tick = integer(raw.tick), generation = integer(raw.generation); return tick != null && generation != null ? Object.freeze({ tick, generation }) : null; };
const verifiedKinds = new Set(['stored-snapshot-checked', 'checksum-verified']);

/** @param {unknown} value @param {{verification?: import('./ProcgenBoundaryContracts.js').ProjectVerification}} options @returns {import('./ProcgenBoundaryContracts.js').ProjectSummary} */
export function readProcgenProjectSummary(value = {}, { verification = 'unverified' } = {}) {
  const raw = record(value), rawRange = record(raw.range);
  const kind = (raw.kind === 'checkpoint' || raw.kind === 'recovery-checkpoint' || raw.kind === 'legacy-recovery') ? raw.kind : 'checkpoint';
  const sequence = integer(rawRange.lastSequence), initial = boundary(rawRange.initial), final = boundary(rawRange.final);
  const range = sequence != null && initial && final ? Object.freeze({ firstSequence: sequence ? 1 : null, lastSequence: sequence, initial, final, verified: verifiedKinds.has(verification) }) : null;
  const sessionVersion = integer(raw.sessionVersion), projectVersion = integer(raw.projectVersion), laneCount = integer(raw.laneCount);
  return Object.freeze({ schema: 'procgen-project-summary/v1', id: bounded(raw.id, 512), name: bounded(raw.name) || (kind === 'checkpoint' ? 'Untitled project' : 'Recovery checkpoint'),
    savedAt: bounded(raw.savedAt, 64), kind, revision: integer(raw.revision), sessionVersion, projectVersion, checkpointVersion: integer(raw.checkpointVersion),
    laneCount: laneCount && laneCount <= 1024 ? laneCount : null, seed: typeof raw.seed === 'number' && Number.isFinite(raw.seed) ? raw.seed : null, tick: integer(raw.tick), generation: integer(raw.generation),
    recoveryGeneration: integer(raw.recoveryGeneration), documentRevision: integer(raw.documentRevision), checksum: bounded(raw.checksum, 128),
    sourceDocumentId: bounded(raw.sourceDocumentId, 512), sourceStoredRevision: integer(raw.sourceStoredRevision), range,
    verification: verifiedKinds.has(verification) ? verification : 'unverified', compatibility: sessionVersion === 1 && projectVersion === 2 ? 'supported-header' : (sessionVersion != null && sessionVersion !== 1 || projectVersion != null && projectVersion > 2) ? 'unsupported-header' : 'check-on-open',
    assetDigest: bounded(raw.assetDigest, 128), buildId: bounded(raw.buildId, 128), paused: true });
}

/** @param {unknown} value @param {import('./ProcgenBoundaryContracts.js').ProjectSummaryOptions} options @returns {import('./ProcgenBoundaryContracts.js').ProjectSummary} */
export function createProcgenProjectSummary(value, options = {}) {
  const session = record(value), journal = record(session.recoveryJournal), source = record(session.executionIdentity), world = record(session.world), project = record(record(session.project).procgen), origin = record(session.recoverySource);
  const hasJournal = session.recoveryJournal != null;
  return readProcgenProjectSummary({ ...options, name: session.name, savedAt: session.savedAt, sessionVersion: session.version, projectVersion: project.version,
    checkpointVersion: world.version, laneCount: world.laneCount, seed: world.seed, tick: record(journal.final).tick ?? world.tickIndex,
    generation: record(journal.final).generation ?? world.generation, range: hasJournal ? { lastSequence: journal.sequence, initial: journal.initial, final: journal.final } : null,
    documentRevision: origin.editRevision, sourceDocumentId: origin.documentId, sourceStoredRevision: origin.storedRevision, assetDigest: source?.assetDigest, buildId: source?.buildId }, { verification: options.verification });
}
