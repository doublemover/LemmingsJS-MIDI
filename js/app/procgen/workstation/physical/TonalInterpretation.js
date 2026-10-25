import { createHarmonicFieldResolver, validateHarmonicField } from './HarmonicFields.js';
import { createFormationHarmony, validateFormationHarmony } from './FormationHarmony.js';
import { boundedList, identity, freeze } from './PhysicalSchema.js';

export function validateTonalDomain(input, domain) {
  const harmonicFields = boundedList(input.harmonicFields ?? [], 128, validateHarmonicField, 'harmonic fields');
  const formations = boundedList(input.formations ?? [], 128, validateFormationHarmony, 'formation harmonies');
  for (const values of [harmonicFields, formations]) if (new Set(values.map(value => value.id)).size !== values.length) throw new Error('Duplicate tonal object identity.');
  for (const object of [...harmonicFields, ...formations]) if (object.ensembleId && !domain.ensembles.some(value => value.id === object.ensembleId)) throw new Error('Tonal ensemble reference is unavailable.');
  for (const object of formations) if (object.routeId && !domain.routes.some(value => value.id === object.routeId)) throw new Error('Tonal route reference is unavailable.');
  if (input.editCommandId != null && !identity(input.editCommandId)) throw new Error('Invalid applied mapping-edit command ID.');
  const resolver = createHarmonicFieldResolver({ getMaterialTag: actor => actor.terrainProvenance ?? { status: 'unknown' } }); resolver.configure(harmonicFields, input.revision);
  return freeze({ harmonicFields, formations, ...(input.editCommandId ? { editCommandId: input.editCommandId } : {}) });
}
export function createTonalInterpretation() {
  let fields = createHarmonicFieldResolver({ getMaterialTag: actor => actor.terrainProvenance ?? { status: 'unknown' } }), formations = createFormationHarmony(), graph = null, batch = null;
  const configure = next => { fields.configure(next.harmonicFields || [], next.revision, next.editCommandId); formations.configure(next.formations || []); graph = next; };
  const resolve = (instrument, actorId, baseCents) => {
    let pitch = { cents: baseCents, referenceHz: 440 }, formation = null, field = null;
    if (instrument.formationId) {
      formation = formations.pitch(instrument.formationId, actorId); if (formation.status !== 'complete') return formation; pitch = formation.pitch;
    }
    if (instrument.harmonicFields) {
      field = fields.pitch(actorId, pitch.cents); if (field.status !== 'complete') return { status: 'unknown', reason: 'field-evidence-unavailable' };
      if (field.pitch) pitch = field.pitch;
    }
    const definition = instrument.formationId ? formations.definition(instrument.formationId) : null;
    return { status: 'complete', pitch: freeze(pitch), state: freeze({ fieldId: field?.pitch?.fieldId ?? null, fieldRevision: field?.pitch?.fieldRevision ?? null,
      heldPolicy: field?.view?.field?.heldPolicy ?? (definition ? 'retune-held' : 'retain-onset'), deletionPolicy: field?.view?.field?.deletionPolicy ?? 'retain',
      slewSeconds: field?.view?.field?.slewSeconds ?? definition?.slewSeconds ?? 0, formationId: instrument.formationId ?? null, edit: field?.view?.edit ?? null,
      reason: field?.pitch ? field.view.edit ? 'applied-field-edit' : 'observed-field-position' : formation?.reason ?? 'authored-pitch' }) };
  };
  const cause = record => {
    const direct = batch.facts.filter(fact => fact.actorId === record.actorId && ['MotionCommitted', 'ContactResolved', 'ActorLaneTransferred'].includes(fact.kind)).at(-1);
    const formation = record.instrument.formationId ? batch.facts.filter(fact => ['MotionCommitted', 'ActorBorn', 'ActorTerminated'].includes(fact.kind)).at(-1) : null;
    const source = direct || formation;
    return source ? { ...source, actorId: record.actorId, laneId: record.laneId, sourceEventIds: [source.eventId], tonalSourceBatchId: batch.batchId } : null;
  };
  return { configure, observe(value, domain) { batch = value; fields.observe(value, domain); formations.observe(value, domain, fields); }, resolve, cause,
    enabled: () => !!(graph?.harmonicFields?.length || graph?.formations?.length),
    snapshot: () => freeze({ version: 1, fields: fields.snapshot(), formations: formations.snapshot() }),
    restore(value) { if (value?.version !== 1) throw new Error('Invalid tonal checkpoint.'); const nextFields = createHarmonicFieldResolver({ getMaterialTag: actor => actor.terrainProvenance ?? { status: 'unknown' } }), nextFormations = createFormationHarmony(); nextFields.configure(graph.harmonicFields || [], graph.revision); nextFormations.configure(graph.formations || []); nextFields.restore(value.fields); nextFormations.restore(value.formations); fields = nextFields; formations = nextFormations; },
    reset() { fields.reset(); formations.reset(); batch = null; }, diagnostics: () => freeze({ fields: fields.diagnostics(), formations: formations.diagnostics() }) };
}
