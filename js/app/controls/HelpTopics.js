const topic = (id, concept, shortHint, exampleFixture, related = [], commandId = null, parameterId = null) =>
  Object.freeze({ id, commandId, parameterId, concept, shortHint, exampleFixture, related: Object.freeze(related) });
export const HELP_TOPICS = Object.freeze([
  topic('spacing', 'Spacing changes arrival rhythm', 'Release spacing changes when actual actors reach a pickup. Travel and interaction can alter the resulting intervals; screen refresh does not create notes.', 'productive-work', ['contact', 'gate']),
  topic('contact', 'Terrain contact changes pitch or timbre', 'An admitted contact fact supplies a named actor, tick and material. Only an eligible physical mapping turns that fact into a musical intent.', 'terrain-contact', ['mapping', 'evidence'], 'workstation.openPhysicalAuthoring'),
  topic('gate', 'Action duration owns the gate', 'A held action owns its logical voice until its matching end. A release tail can continue after the actor or action has ended.', 'action-duration', ['contact', 'tails']),
  topic('mapping', 'Typed physical mappings', 'Choose an actual source quantity and target unit. Stable binding IDs determine contribution order. Learned observations require review and are not a complete range calibration.', 'formation-and-timbre', ['evidence', 'control'], 'workstation.openPhysicalMappings'),
  topic('evidence', 'Read one cause through the sound path', 'Physical cause, mapping eligibility, intent, output admission and acoustic hearing are separate observations. An absent receipt is unknown; it is not a successful render.', 'first-sound', ['contact', 'monitor'], 'workstation.whyNoSound'),
  topic('tails', 'Released voices and shared bodies', 'A released voice or excited shared body can still sound. Effect motion describes available telemetry; it cannot prove what an external listener heard.', 'action-duration', ['evidence', 'monitor']),
  topic('monitor', 'Choose the output you are listening to', 'Listen locally deliberately enables browser output. A MIDI API submission does not confirm a receiver, amplifier or loudspeaker. Prelisten has its own routing.', 'first-sound', ['evidence'], 'workstation.openPrelistenMonitor'),
  topic('control', 'Authored value and modulation', 'The canonical value, observed controller pickup and effective model are distinct. An unknown effective value stays unknown. Accepted controls use the existing edit and ownership policy.', null, ['mapping', 'evidence']),
  topic('shared-tail', 'A body can outlive its striker', 'A real contact excites a separately owned prepared body. Ending that actor or finite exciter does not create another attack or erase the body. Residency is observable ownership; audible ringing still needs real output and listening. Released damping cannot restore lost energy.', 'body-keeps-the-ring', ['tails', 'contact', 'evidence']),
  topic('move-memory', 'Physical travel moves frozen material', 'A declared signed-axis metric maps completed world pixels to original source frames. A stationary physical tick adds no distance; the admitted read segment can finish and fade while a body decays. Returning on the same owned voice changes the coordinate direction without making another attack.', 'move-the-memory', ['frozen-seed', 'gate', 'tails', 'evidence']),
  topic('frozen-seed', 'A frozen seed keeps its original causes', 'A saved seed plays immutable material. Two new physical contacts create two new playback onsets; any transients printed inside that material remain old ancestry. Cropping or rebuilding cannot silently rename an old cause as a new event.', 'hear-the-fossil', ['contact', 'capture', 'evidence']),
  topic('make-and-keep', 'Keep a sound and reopen its exact project', 'Observe one real contact, change only its sound with a kept variation, save and reopen that exact named revision, then predict the next contact. A download request or Save click alone cannot prove that the pinned sound survived reopen.', 'make-and-keep', ['save', 'contact', 'evidence']),
  topic('save', 'Save a physical checkpoint', 'Save stores the authored project and its declared physical continuation. Crash recovery and an exported performance file have separate delivery status.', null, ['evidence'], 'workstation.save'),
  topic('capture', 'Record the browser master', 'Master capture records the selected browser audio owner. External MIDI output has no automatic acoustic return.', null, ['monitor'], 'workstation.openMasterCapture'),
  topic('pitch', 'Pitch is a typed physical target', 'Inspect the original continuous pitch, selected target and logical voice in Harmony. Future candidates are shown only when the engine supplies them.', 'formation-and-timbre', ['mapping', 'evidence'], null, 'pitch-offset')
]);
const byId = new Map(HELP_TOPICS.map(value => [value.id, value]));
const byCommand = new Map(HELP_TOPICS.filter(value => value.commandId).map(value => [value.commandId, value]));
export const helpTopic = id => byId.get(id) || null;
export const commandHelpTopic = commandId => byCommand.get(commandId) || null;
export function parameterHelpText(descriptor, { effectiveValue = null, pickupValue = null, readOnly = false, pending = false } = {}) {
  const concept = HELP_TOPICS.find(value => value.parameterId === descriptor.quantity) || byId.get('control');
  return descriptor.name + ': ' + descriptor.quantity + '; ' + descriptor.min + ' through ' + descriptor.max + ' ' + descriptor.unit +
    '; reset ' + descriptor.defaultValue + '; step ' + descriptor.step + '; Shift fine step ' + descriptor.fineStep +
    '. Drag or use arrows; Page Up/Down changes ten steps; Home/End reaches limits. Reset is an explicit edit. ' +
    (pending ? 'Preparation owns this control; editing is pending. ' : readOnly ? 'This target is read-only. ' : 'Manual edits use the canonical target owner. ') +
    (Number.isFinite(effectiveValue) ? 'Observed effective model ' + effectiveValue + ' ' + descriptor.unit + '. ' : 'Effective model unobserved. ') +
    (Number.isFinite(pickupValue) ? 'Observed MIDI pickup ' + pickupValue + ' ' + descriptor.unit + '. ' : 'No controller pickup observation. ') + concept.shortHint;
}
