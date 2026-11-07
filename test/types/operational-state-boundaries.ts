import { createProcgenOperationalSnapshot } from '../../js/app/procgen/workstation/ProcgenOperationalState.js';
import { createProcgenOperationalView } from '../../js/app/procgen/workstation/ProcgenOperationalView.js';
import type { OperationalSource, OperationalSnapshot, OperationalActionId } from '../../js/app/procgen/workstation/ProcgenOperationalContracts.js';
import type { OperationView } from '../../js/app/procgen/workstation/ProcgenBoundaryContracts.js';

declare const operation: OperationView;
declare const document: Document;
const source: OperationalSource = { identity: 'doc:7', documentRevision: 3, operations: [operation], simulation: { available: true, tickDurationMs: 60 },
  output: { selectedBackend: 'midi', selectedOutputId: 'device:1', midiPermission: 'granted' },
  midi: { outputRoutes: [{ outputId: 'device:1', connectionEpoch: 2 }], inputLiveness: { lastTrafficTime: null } }, storage: { error: Symbol('opaque error') } };
const snapshot: OperationalSnapshot = createProcgenOperationalSnapshot(source);
const action: OperationalActionId = snapshot.recoveryAction.id;
const view = createProcgenOperationalView({ document, readSnapshot: () => snapshot, performAction: (id, identity) => { const command: OperationalActionId = id; const target: string = identity; void command; void target; } });
const presented: boolean = view.presentOutputLabel('Activate selected output'); view.render(null); view.render(snapshot); view.dispose(); void presented; void action;
// @ts-expect-error The source revision is a scalar revision, not an authored document.
createProcgenOperationalSnapshot({ documentRevision: { revision: 3 } });
// @ts-expect-error Measured world ticks retain numeric milliseconds.
createProcgenOperationalSnapshot({ simulation: { tickDurationMs: '60ms' } });
// @ts-expect-error A MIDI connection epoch cannot become a textual source identifier.
createProcgenOperationalSnapshot({ midi: { outputRoutes: [{ outputId: 'device:1', connectionEpoch: 'second' }] } });
// @ts-expect-error Port availability is distinct from a textual liveness report.
createProcgenOperationalSnapshot({ midi: { inputPortConnected: 'alive' } });
// @ts-expect-error Controller observation time is numeric or explicitly unavailable.
createProcgenOperationalSnapshot({ midi: { inputLiveness: { lastTrafficTime: 'recently' } } });
// @ts-expect-error A destination identity is required for every route observation.
createProcgenOperationalSnapshot({ midi: { outputRoutes: [{ active: true }] } });
// @ts-expect-error Known transport booleans cannot become generic strings.
createProcgenOperationalSnapshot({ transport: { playing: 'yes' } });
// @ts-expect-error Operations expose the canonical phase schema.
createProcgenOperationalSnapshot({ operations: [{ ...operation, phase: 'finished-ish' }] });
// @ts-expect-error A snapshot reader is synchronous and cannot defer output-label readiness.
createProcgenOperationalView({ document, readSnapshot: async () => snapshot, performAction() {} });
// @ts-expect-error Recovery command IDs are a closed existing action set.
const invalidAction: OperationalActionId = 'rearm-all-ports';
// @ts-expect-error Render consumes a complete snapshot, not a partial speculative status.
view.render({ version: 1, identity: 'partial' });
// @ts-expect-error Labels are bounded strings at the actual presenter API.
view.presentOutputLabel({ text: 'Listen' });
// @ts-expect-error A published destination cannot be overwritten by a view.
snapshot.noteOutput.selectedId = 'other';
// @ts-expect-error A display cannot fabricate a new controller connection epoch.
snapshot.controller.connectionEpoch = 9;
// @ts-expect-error Display values preserve their numeric or unavailable result.
const age: string = snapshot.controller.evidenceAgeMs;
// @ts-expect-error A snapshot version is an exact schema discriminator.
const unsupported: OperationalSnapshot = { ...snapshot, version: 2 };
// @ts-expect-error The operation collection is immutable.
snapshot.operations.push(operation);
// @ts-expect-error Operation phase is immutable through the snapshot.
snapshot.operations[0].phase = 'committing';
// @ts-expect-error Blocking-scope arrays stay deeply immutable through the status surface.
snapshot.operations[0].blockingScopes.push('invented');
// @ts-expect-error Conditions are immutable published observations.
snapshot.conditions[0].detail = 'hide the failure';
// @ts-expect-error Route state uses the published route-state vocabulary.
const invalidRoute: OperationalSnapshot['noteOutput'] = { ...snapshot.noteOutput, state: 'receiver-confirmed' };
// @ts-expect-error Recovery state does not certify physical receipt.
const acoustic: true = snapshot.nativeOutputActionAllowed;
void invalidAction; void age; void unsupported; void invalidRoute; void acoustic;
