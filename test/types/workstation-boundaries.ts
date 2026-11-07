import { readProcgenProjectSummary } from '../../js/app/procgen/workstation/ProcgenProjectSummary.js';
import { createProcgenReplacementReview } from '../../js/app/procgen/workstation/ProcgenReplacementPolicy.js';
import { createProcgenOperationReceipt, createProcgenOperationView } from '../../js/app/procgen/workstation/ProcgenOperationView.js';
import { createPerformanceSceneLoader } from '../../js/app/procgen/workstation/PerformanceSceneLoader.js';
import type { SceneCandidate, SceneCommitReceipt } from '../../js/app/procgen/workstation/ProcgenBoundaryContracts.js';
const source = { documentIdentity: 'document:1', projectRevision: 2, editRevision: 3 };
const committed = createProcgenOperationReceipt({ id: 'open:1', kind: 'scene', source, outcome: 'committed', accepted: source });
const canceled = createProcgenOperationReceipt({ id: 'open:2', kind: 'scene', source, outcome: 'canceled' });
if (committed.outcome === 'committed') { const accepted: string = committed.accepted.documentIdentity; void accepted; }
if (canceled.outcome === 'canceled') { const accepted: null = canceled.accepted; void accepted; }
// @ts-expect-error A failed operation cannot claim an accepted document boundary.
createProcgenOperationReceipt({ id: 'open:3', kind: 'scene', source, outcome: 'failed', accepted: source });
// @ts-expect-error A committed operation must carry its accepted boundary.
createProcgenOperationReceipt({ id: 'open:4', kind: 'scene', source, outcome: 'committed' });
// @ts-expect-error A world ID does not supply the required document revision boundary.
createProcgenOperationReceipt({ id: 'open:5', kind: 'scene', source: { worldId: 'world:1' }, outcome: 'canceled' });
// @ts-expect-error Progress labels are constrained to actual supported phases.
createProcgenOperationView({ id: 'open:6', kind: 'scene', phase: 'done-ish' });
const summary = readProcgenProjectSummary({ graph: new Uint8Array(4), id: 'doc:1' });
// @ts-expect-error Metadata projections are read-only and cannot become mutation owners.
summary.name = 'Changed outside the owner';
// @ts-expect-error A metadata projection is not a full session/operation source.
createProcgenOperationReceipt({ id: 'open:7', kind: 'load', source: summary, outcome: 'canceled' });
const review = createProcgenReplacementReview({ identity: 'review:1', documentIdentity: '1', drafts: { textDrafts: 1 } });
// @ts-expect-error Review reasons cannot be appended by a presentation consumer.
review.reasons.push('Inferred dirty state');
// @ts-expect-error Capture/recording activity is a boolean contract, not a status string.
createProcgenReplacementReview({ identity: 'review:2', documentIdentity: '1', recording: { active: 'recording' } });
const applied: SceneCommitReceipt = { status: 'committed', sceneHash: 'a', baseIdentity: 'doc:1', policy: 'stopped-replacement', transportPlaying: false, externalOutputEnabledByScene: false, recordingArmedByScene: false, localAudioEnabledByScene: false };
const candidate: SceneCandidate = { sceneHash: 'a', baseIdentity: 'doc:1', variants: [], admission: { status: 'admitted', world: true, sound: true, mapping: true }, commit({ isCurrent }) { isCurrent(); return applied; }, retire() { return { outcome: 'complete' }; } };
// @ts-expect-error The synchronous publication fence cannot be replaced by a promise.
candidate.commit({ policy: 'stopped-replacement', isCurrent: async () => true });
const loader = createPerformanceSceneLoader({ getBaseIdentity: () => 'doc:1', resolveDependency: () => null, prepareCandidate: async () => candidate });
loader.apply({ onCommitted(receipt) { const policy: 'stopped-replacement' = receipt.policy; void policy; } });
// @ts-expect-error The accepted-boundary handoff must finish synchronously before retirement.
loader.apply({ onCommitted: async () => {} });

import { createProcgenSessionStorage } from '../../js/app/procgen/workstation/ProcgenSessionStorage.js';
const storage = createProcgenSessionStorage();
storage.listDocumentPage({ cursor: { savedAt: '2026-11-05T00:00:00Z', id: 'doc:1' }, signal: new AbortController().signal });
// @ts-expect-error Pagination requires its metadata tuple, not an unrelated opaque token.
storage.listDocumentPage({ cursor: 'old-operation-id' });
// @ts-expect-error A selected stored revision is numeric and separate from the document ID.
storage.loadDocumentOwned('doc:1', { expectedRevision: 'doc:1' });
// @ts-expect-error Abort ownership is an AbortSignal, not a reusable status flag.
storage.loadRecovery({ signal: true });
