const integer = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const bounded = (value, length = 120) => typeof value === 'string' && value.length <= length ? value : null;
const boundary = value => value && integer(value.tick) != null && integer(value.generation) != null ? Object.freeze({ tick: value.tick, generation: value.generation }) : null;
const verifiedKinds = new Set(['stored-snapshot-checked', 'checksum-verified']);

export function readProcgenProjectSummary(value = {}, { verification = 'unverified' } = {}) {
  const raw = value && typeof value === 'object' ? value : {};
  const kind = ['checkpoint', 'recovery-checkpoint', 'legacy-recovery'].includes(raw.kind) ? raw.kind : 'checkpoint';
  const sequence = integer(raw.range?.lastSequence), initial = boundary(raw.range?.initial), final = boundary(raw.range?.final);
  const range = sequence != null && initial && final ? Object.freeze({ firstSequence: sequence ? 1 : null, lastSequence: sequence, initial, final, verified: verifiedKinds.has(verification) }) : null;
  const sessionVersion = integer(raw.sessionVersion), projectVersion = integer(raw.projectVersion), laneCount = integer(raw.laneCount);
  return Object.freeze({ schema: 'procgen-project-summary/v1', id: bounded(raw.id, 512), name: bounded(raw.name) || (kind === 'checkpoint' ? 'Untitled project' : 'Recovery checkpoint'),
    savedAt: bounded(raw.savedAt, 64), kind, revision: integer(raw.revision), sessionVersion, projectVersion, checkpointVersion: integer(raw.checkpointVersion),
    laneCount: laneCount && laneCount <= 1024 ? laneCount : null, seed: Number.isFinite(raw.seed) ? raw.seed : null, tick: integer(raw.tick), generation: integer(raw.generation),
    recoveryGeneration: integer(raw.recoveryGeneration), documentRevision: integer(raw.documentRevision), checksum: bounded(raw.checksum, 128),
    sourceDocumentId: bounded(raw.sourceDocumentId, 512), sourceStoredRevision: integer(raw.sourceStoredRevision), range,
    verification: verifiedKinds.has(verification) ? verification : 'unverified', compatibility: sessionVersion === 1 && projectVersion === 2 ? 'supported-header' : (sessionVersion != null && sessionVersion !== 1 || projectVersion != null && projectVersion > 2) ? 'unsupported-header' : 'check-on-open',
    assetDigest: bounded(raw.assetDigest, 128), buildId: bounded(raw.buildId, 128), paused: true });
}

export function createProcgenProjectSummary(session, options = {}) {
  const journal = session.recoveryJournal, source = session.executionIdentity;
  return readProcgenProjectSummary({ ...options, name: session.name, savedAt: session.savedAt, sessionVersion: session.version, projectVersion: session.project?.procgen?.version,
    checkpointVersion: session.world?.version, laneCount: session.world?.laneCount, seed: session.world?.seed, tick: journal?.final?.tick ?? session.world?.tickIndex,
    generation: journal?.final?.generation ?? session.world?.generation, range: journal ? { lastSequence: journal.sequence, initial: journal.initial, final: journal.final } : null,
    documentRevision: session.recoverySource?.editRevision, sourceDocumentId: session.recoverySource?.documentId, sourceStoredRevision: session.recoverySource?.storedRevision, assetDigest: source?.assetDigest, buildId: source?.buildId }, { verification: options.verification });
}
