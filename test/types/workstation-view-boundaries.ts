import type { WorkstationViewOptions, WorkstationUiState, WorkstationViewCommand } from '../../js/app/procgen/workstation/ProcgenWorkstationViewContracts.js';
import { createMidiWorkstationAdapterOwner } from '../../js/midi/router/MidiWorkstationAdapter.js';
import { subscribeMidiPreviewRouter } from '../../js/midi/MidiPreviewSubscriptions.js';
import { MidiScheduler } from '../../js/midi/MidiScheduler.js';

declare const options: WorkstationViewOptions;
declare const state: WorkstationUiState;
state.slot = 2;
state.workspaceMode = 'perform';
// @ts-expect-error A pattern slot remains numeric through the canonical controller/view state.
state.slot = 'second';
// @ts-expect-error Dock modes are the existing authored choices.
state.workspaceMode = 'phone';
// @ts-expect-error Recording is an owned boolean, not an arbitrary status label.
state.recording = 'active';
// @ts-expect-error Unknown handlers cannot be introduced through the view boundary.
options.handlers = { replaceTheWorld() {} };
// @ts-expect-error Safe command wrappers preserve the real export protocol choices.
options.handlers?.exportMidi?.({ format: 'invented' });
// @ts-expect-error Document identity cannot become a mutable project object.
options.getDocumentIdentity = () => ({ id: 'doc:1' });
const command: WorkstationViewCommand = { id: 'step', label: 'Next step', contexts: ['pattern'], repeat: true, enabled: () => true, execute() {} };
// @ts-expect-error Repeating keyboard commands declare a boolean policy.
command.repeat = 'sometimes';
const adapter = createMidiWorkstationAdapterOwner();
const lease = adapter.bind({ onEvent: () => true, getAutomationSpanState: () => null });
lease.release();
// @ts-expect-error Event interception is synchronous and declares whether it consumed the event.
adapter.bind({ onEvent: async () => true, getAutomationSpanState: () => null });
// @ts-expect-error Every adapter includes its automation provider.
adapter.bind({ onEvent: () => true });
const host = { midiPreviewRouter: { id: 'router:1' } };
subscribeMidiPreviewRouter(host, router => { const id: string = router.id; void id; });
// @ts-expect-error A subscription preserves its host's router identity shape.
subscribeMidiPreviewRouter(host, (router: number) => { void router; });
const activity = new MidiScheduler().getOutputActivity();
const count: number = activity.activeNotes;
void count;
// @ts-expect-error Activity snapshots cannot expose mutable scheduler state.
activity.pendingNotes = 3;
