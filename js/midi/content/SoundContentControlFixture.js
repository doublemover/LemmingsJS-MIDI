import { freezeData } from '../../core/CanonicalData.js';

export const SOUND_CONTENT_CONTROL_FIXTURE = freezeData({ schema: 'lemmings-control-audition/v1', id: 'pressure-pan-pitch-v1', source: 'authored-control-fixture',
  physicalTakeEvidence: false, events: [
    { kind: 'begin', seconds: 0, pitchCents: 6000, velocity01: 0.6, expression: { pressure01: 0.3, pan01: 0 } },
    { kind: 'update', seconds: 0.3, expression: { pressure01: 0.9, pan01: -0.5 } },
    { kind: 'update', seconds: 0.7, expression: { pressure01: 0.5, pan01: 0.5, pitchOffsetCents: 100 } },
    { kind: 'end', seconds: 1 }
  ] });

export function sampleMapControlFixture(map, gesture = map?.neutralArticulationId) {
  if (!map?.articulations?.some(entry => entry.id === gesture)) throw new Error('Choose an authored sample gesture for the control fixture.');
  return freezeData({ ...SOUND_CONTENT_CONTROL_FIXTURE, id: 'pressure-pan-pitch-sample-gesture-v1', durationScale: 0.2, events: SOUND_CONTENT_CONTROL_FIXTURE.events.map(event =>
    ({ ...event, seconds: event.seconds * 0.2, ...(event.kind === 'begin' ? { sampleGesture: gesture } : {}) })) });
}

export const TEXTURE_CONTROL_FIXTURE = freezeData({ ...SOUND_CONTENT_CONTROL_FIXTURE, id: 'spatial-texture-eight-pixel-control-v1',
  motionProgram: 'eight-pixels-in-forty-ms;then-rest-and-tail;authored-not-physical-take', events: SOUND_CONTENT_CONTROL_FIXTURE.events.map(event => ({ ...event,
    ...(event.expression ? { expression: Object.fromEntries(Object.entries(event.expression).filter(([key]) => key !== 'pitchOffsetCents')) } : {}) })) });

export const FRICTION_CONTROL_FIXTURE = freezeData({ ...TEXTURE_CONTROL_FIXTURE, id: 'sealed-friction-seventy-eight-pixel-control-v1', motionProgram: 'seventy-eight-pixels-in-six-hundred-fifty-ms;then-rest-and-tail;authored-not-physical-take' });

export const WIND_CONTROL_FIXTURE = freezeData({ ...SOUND_CONTENT_CONTROL_FIXTURE, id: 'sealed-wind-held-pressure-v1', events: TEXTURE_CONTROL_FIXTURE.events });

export function seedLayerControlFixture(patch) {
  const material = patch?.seedLayers?.components?.[0], root = patch?.parameters?.rootHz ?? 261.6255653005986;
  if (!material || !Number.isSafeInteger(material.sourceFrames) || !Number.isSafeInteger(material.sourceRate) || material.sourceFrames < 2 || material.sourceRate < 8000 || material.sourceFrames > material.sourceRate * 8 || !Number.isFinite(root) || root < 20 || root > 2000) throw new TypeError('Layered audition requires exact component timing and an explicit grain/body root.');
  const hold = Math.min(8, material.sourceFrames / material.sourceRate + 0.02);
  return freezeData({ schema: 'lemmings-control-audition/v1', id: 'three-aligned-seed-children-one-onset-v1', source: 'authored-control-fixture', physicalTakeEvidence: false,
    events: [{ kind: 'begin', seconds: 0, pitchCents: 6900 + 1200 * Math.log2(root / 440), velocity01: 0.6, expression: { pressure01: 0.6, pan01: 0 } },
      { kind: 'update', seconds: hold / 3, expression: { pressure01: 0.8, pan01: -0.25 } },
      { kind: 'update', seconds: hold * 2 / 3, expression: { pressure01: 0.5, pan01: 0.25 } }, { kind: 'end', seconds: hold }] });
}
