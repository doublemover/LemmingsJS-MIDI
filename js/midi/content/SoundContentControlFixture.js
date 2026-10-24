import { freezeData } from '../../core/CanonicalData.js';

export const SOUND_CONTENT_CONTROL_FIXTURE = freezeData({ schema: 'lemmings-control-audition/v1', id: 'pressure-pan-pitch-v1', source: 'authored-control-fixture',
  physicalTakeEvidence: false, events: [
    { kind: 'begin', seconds: 0, pitchCents: 6000, velocity01: 0.6, expression: { pressure01: 0.3, pan01: 0 } },
    { kind: 'update', seconds: 0.3, expression: { pressure01: 0.9, pan01: -0.5 } },
    { kind: 'update', seconds: 0.7, expression: { pressure01: 0.5, pan01: 0.5, pitchOffsetCents: 100 } },
    { kind: 'end', seconds: 1 }
  ] });
