import { expect } from 'chai';
import { readFile } from 'node:fs/promises';
import {
  MIDI_PROJECT_EXPORT_KIND,
  MIDI_PROJECT_VERSION,
  MIDI_TEMPLATE_EXPORT_KIND,
  createMidiProjectExportPayload,
  createMidiProjectTemplate,
  createMidiProjectFromMidiConfig,
  detectMidiProjectConflicts,
  importMidiProjectPayload,
  projectToMidiConfig,
  reduceMidiProject,
  sanitizeMidiProject,
  stringifyMidiProjectExport
} from '../../js/midi/project/MidiProject.js';

const loadFactoryConfig = async () => JSON.parse(
  await readFile(new URL('../../midi-mapping.json', import.meta.url), 'utf8')
);

describe('MidiProject', function() {
  it('creates a canonical project from the MIDI mapping factory config', async function() {
    const factoryConfig = await loadFactoryConfig();
    const project = createMidiProjectFromMidiConfig({
      ...factoryConfig,
      triggers: {
        '42': { note: 72, velocity: 90, durationTicks: 5, pitchBend: 0.5, envelope: { attack: 1.2 } }
      }
    });

    expect(project.version).to.equal(MIDI_PROJECT_VERSION);
    expect(project.id).to.equal('factory-midi-project');
    expect(project.templateId).to.equal('midi-mapping');
    expect(project.enabled).to.equal(false);
    expect(project.devices.inputChannel).to.equal('omni');
    expect(project.transport).to.include({ bpmBase: 120, quantize: '1/16', swing: 0 });
    expect(project.global.density).to.include({ velocityBoost: 0.4, durationScale: 0.5 });
    expect(project.global.position).to.include({ viewPan: false });
    expect(project.automation.map(lane => lane.target)).to.include.members(['velocity', 'timbre']);
    expect(project.tracks[0]).to.include({
      id: 'track-1',
      outputId: null,
      channel: 1,
      instrumentLabel: 'General MIDI',
      mute: false,
      solo: false,
      arm: false,
      velocityScale: 1,
      priority: 1,
      voiceBudget: 32
    });

    const disabledSfx = project.sources.find(source => source.kind === 'sfx' && source.sourceKey === '19');
    expect(disabledSfx).to.include({
      id: 'sfx-19',
      label: 'fell-off',
      enabled: false,
      trackId: 'track-1',
      mode: 'direct',
      clipId: null
    });
    expect(disabledSfx.mapping).to.include({ note: 50, durationTicks: 6 });
    expect(disabledSfx.mapping.disabled).to.equal(undefined);

    const trigger = project.sources.find(source => source.kind === 'trigger' && source.sourceKey === '42');
    expect(trigger.mapping).to.include({
      note: 72,
      velocity: 90,
      durationTicks: 5,
      pitchBend: 0.5
    });
    expect(trigger.mapping.envelope).to.include({ attack: 1.2 });
  });

  it('sanitizes channels, notes, velocities, durations, ids, clips, and selections', function() {
    const project = sanitizeMidiProject({
      tracks: [
        { id: 'track-a', channel: 99, priority: 2, mute: true, velocityScale: 9 },
        { id: 'track-a', channel: -1 }
      ],
      sources: [
        {
          id: 'sfx-a',
          kind: 'sfx',
          sourceKey: '1',
          trackId: 'track-a',
          mapping: {
            note: 999,
            notes: [-5, 64, 999],
            velocity: 0,
            durationTicks: 9999,
            pan: -999,
            timbre: 999,
            pitchBend: 7
          }
        },
        { id: '', kind: 'bad', sourceKey: '', trackId: 'missing', mapping: { note: -7 } }
      ],
      clips: [
        { id: 'clip-a', name: '', type: 'bad', lengthSteps: 999, steps: [{ note: 999, probability: 4 }] }
      ],
      automation: [
        {
          id: 'lane-a',
          name: '',
          target: 'bad',
          axis: 'bad',
          min: '10',
          max: '20',
          points: [{ beat: 4, value: 2 }, { beat: 1, value: 8 }]
        },
        { id: 'lane-a', target: 'pan', axis: 'xy', min: -999, max: 999 }
      ],
      global: {
        density: { windowTicks: -1, velocityBoost: 99, durationScale: 2 },
        envelope: { attack: 9, decay: -1, sustain: 3, release: 0.5 },
        position: { viewPan: true, panRange: { min: -999, max: 999 } }
      },
      ui: {
        selectedTrackId: 'missing',
        selectedSourceId: 'missing',
        selectedClipId: 'missing'
      },
      devices: {
        inputChannel: 99
      }
    });

    expect(project.tracks.map(track => track.id)).to.deep.equal(['track-a', 'track-a-2']);
    expect(project.tracks[0]).to.include({ channel: 16, mute: true, velocityScale: 4 });
    expect(project.tracks[1].channel).to.equal(1);
    expect(project.devices.inputChannel).to.equal(16);
    expect(project.sources[0].mapping).to.include({
      note: 127,
      velocity: 1,
      durationTicks: 960,
      pan: -127,
      timbre: 127,
      pitchBend: 1
    });
    expect(project.sources[0].mapping.notes).to.deep.equal([0, 64, 127]);
    expect(project.sources[1]).to.include({ kind: 'sfx', sourceKey: '2', trackId: 'track-a' });
    expect(project.clips).to.have.lengthOf(1);
    expect(project.clips[0]).to.include({ name: 'Clip 1', type: 'stepPattern', lengthSteps: 256 });
    expect(project.clips[0].steps[0]).to.include({ note: 127, probability: 1 });
    expect(project.global.density).to.deep.equal({ windowTicks: 0, velocityBoost: 4, durationScale: 1 });
    expect(project.global.envelope).to.deep.equal({ attack: 2, decay: 0, sustain: 2, release: 0.5 });
    expect(project.global.position.viewPan).to.equal(true);
    expect(project.global.position.panRange).to.deep.equal({ min: -127, max: 127 });
    expect(project.automation.map(lane => lane.id)).to.deep.equal(['lane-a', 'lane-a-2']);
    expect(project.automation[0]).to.include({ name: 'velocity modulation', target: 'velocity', axis: 'y', min: 10, max: 20 });
    expect(project.automation[0].points.map(point => point.beat)).to.deep.equal([1, 4]);
    expect(project.automation[1]).to.include({ target: 'pan', axis: 'xy', min: -999, max: 999 });
    expect(project.ui.selectedTrackId).to.equal('track-a');
    expect(project.ui.selectedSourceId).to.equal('sfx-a');
    expect(project.ui.selectedClipId).to.equal(null);
  });

  it('reduces setup-to-audition project intents', function() {
    let project = createMidiProjectFromMidiConfig({
      sfx: { '1': { name: 'skill-select', note: 60, durationTicks: 4 } },
      triggers: { '5': { name: 'trap', note: 55 } }
    });

    project = reduceMidiProject(project, { type: 'enabled.set', enabled: true });
    project = reduceMidiProject(project, { type: 'devices.set', devices: { inputId: 'in-1', outputId: 'out-1', inputChannel: 4 } });
    project = reduceMidiProject(project, { type: 'transport.set', transport: { bpmBase: 95, timeSignature: { beats: 7, unit: 8 } } });
    project = reduceMidiProject(project, { type: 'track.add', track: { id: 'lead', name: 'Lead', channel: 3 } });
    project = reduceMidiProject(project, { type: 'track.update', trackId: 'lead', patch: { solo: true, priority: 5, instrumentLabel: 'Lead synth' } });
    project = reduceMidiProject(project, { type: 'track.select', trackId: 'lead' });
    project = reduceMidiProject(project, { type: 'source.assignTrack', sourceId: 'sfx-1', trackId: 'lead' });
    project = reduceMidiProject(project, { type: 'source.update', sourceId: 'sfx-1', patch: { enabled: true, label: 'Select' } });
    project = reduceMidiProject(project, { type: 'source.mapping.update', sourceId: 'sfx-1', patch: { note: 200, velocity: 0, pan: -48, timbre: 96, pitchBend: 0.25, arp: { enabled: true, mode: 'down' } } });
    project = reduceMidiProject(project, { type: 'source.select', sourceId: 'sfx-1' });
    project = reduceMidiProject(project, { type: 'ui.set', ui: { activeRegion: 'audition' } });

    expect(project.enabled).to.equal(true);
    expect(project.devices).to.deep.equal({ inputId: 'in-1', outputId: 'out-1', inputChannel: 4 });
    expect(project.transport.bpmBase).to.equal(95);
    expect(project.transport.timeSignature).to.deep.equal({ beats: 7, unit: 8 });
    expect(project.ui).to.include({ selectedTrackId: 'lead', selectedSourceId: 'sfx-1', activeRegion: 'audition' });
    expect(project.tracks.find(track => track.id === 'lead')).to.include({ channel: 3, solo: true, priority: 5, instrumentLabel: 'Lead synth' });
    expect(project.sources[0]).to.include({ trackId: 'lead', label: 'Select' });
    expect(project.sources[0].mapping).to.include({ note: 127, velocity: 1, pan: -48, timbre: 96, pitchBend: 0.25 });
    expect(project.sources[0].mapping.arp).to.include({ enabled: true, mode: 'down' });
    expect(projectToMidiConfig(project, {}).sfx['1']).to.include({ pan: -48, timbre: 96, pitchBend: 0.25 });
    expect(projectToMidiConfig(project, {}).sfx['1'].arp).to.include({ enabled: true, mode: 'down' });
  });

  it('sanitizes invalid reducer selection intents', function() {
    let project = createMidiProjectFromMidiConfig({
      sfx: { '1': { name: 'skill-select', note: 60 } },
      triggers: {}
    });
    project = reduceMidiProject(project, {
      type: 'clip.add',
      clip: { id: 'riff', name: 'Riff', lengthSteps: 4 }
    });

    const badTrack = reduceMidiProject(project, { type: 'track.select', trackId: 'missing-track' });
    expect(badTrack.ui).to.include({ selectedTrackId: 'track-1', activeRegion: 'tracks' });

    const badSource = reduceMidiProject(project, { type: 'source.select', sourceId: 'missing-source' });
    expect(badSource.ui).to.include({ selectedSourceId: 'sfx-1', activeRegion: 'sources' });

    const badClip = reduceMidiProject(project, { type: 'clip.select', clipId: 'missing-clip' });
    expect(badClip.ui).to.include({ selectedClipId: null, activeRegion: 'clips' });
  });

  it('reduces clip library, step editing, source assignment, and runtime clip lowering', function() {
    let project = createMidiProjectFromMidiConfig({
      sfx: { '1': { name: 'skill-select', note: 60, durationTicks: 4 } },
      triggers: { '5': { name: 'trap', note: 55 } }
    });

    project = reduceMidiProject(project, { type: 'clip.add', clip: { id: 'riff', name: 'Riff', lengthSteps: 4 } });
    project = reduceMidiProject(project, { type: 'clip.update', clipId: 'riff', patch: { name: 'Lead Riff', type: 'arp', arp: { mode: 'down', pattern: { preset: 'custom', steps: ['up', 'hold', 'down'] } } } });
    project = reduceMidiProject(project, { type: 'clip.step.update', clipId: 'riff', stepIndex: 0, patch: { note: 64, velocity: 96, durationTicks: 5 } });
    project = reduceMidiProject(project, { type: 'clip.step.update', clipId: 'riff', stepIndex: 1, patch: { note: 67, probability: 0.5 } });
    project = reduceMidiProject(project, { type: 'clip.step.update', clipId: 'riff', stepIndex: 2, patch: { note: 999, tie: true } });
    project = reduceMidiProject(project, { type: 'source.clip.assign', sourceId: 'sfx-1', clipId: 'riff' });
    project = reduceMidiProject(project, { type: 'source.clip.assign', sourceId: 'trigger-5', clipId: 'riff' });
    project = reduceMidiProject(project, { type: 'clip.select', clipId: 'riff' });

    expect(project.ui.selectedClipId).to.equal('riff');
    expect(project.clips[0]).to.include({ id: 'riff', name: 'Lead Riff', type: 'arp', lengthSteps: 4 });
    expect(project.clips[0].steps[0]).to.include({ index: 0, note: 64, velocity: 96, durationTicks: 5 });
    expect(project.clips[0].steps[1]).to.include({ index: 1, note: 67, probability: 0.5 });
    expect(project.clips[0].steps[2]).to.include({ index: 2, note: 127, tie: true });
    expect(project.sources[0]).to.include({ mode: 'clip', clipId: 'riff', mapping: null });

    const config = projectToMidiConfig(project, {});
    expect(config.sfx['1']).to.include({
      name: 'skill-select',
      note: 64,
      velocity: 96,
      durationTicks: 5,
      channel: 1,
      clipId: 'riff',
      clipType: 'arp'
    });
    expect(config.sfx['1'].notes).to.deep.equal([64, 67]);
    expect(config.sfx['1'].arp).to.include({ enabled: true, mode: 'down', length: 2 });
    expect(config.sfx['1'].arp.pattern).to.deep.equal({ preset: 'custom', steps: ['up', 'hold', 'down'] });
    expect(config.triggers['5']).to.include({ note: 64, clipId: 'riff', clipType: 'arp' });
    expect(config.triggers['5'].notes).to.deep.equal([64, 67]);
  });

  it('flags reducer-assigned missing clips and lowers them as disabled runtime mappings', function() {
    let project = createMidiProjectFromMidiConfig({
      enabled: true,
      sfx: { '1': { name: 'skill-select', note: 60, durationTicks: 4 } },
      triggers: {}
    });

    project = reduceMidiProject(project, {
      type: 'source.clip.assign',
      sourceId: 'sfx-1',
      clipId: 'missing-riff'
    });

    expect(project.sources[0]).to.include({
      mode: 'clip',
      clipId: null,
      mapping: null
    });

    const report = detectMidiProjectConflicts(project);
    expect(report.ok).to.equal(false);
    expect(report.bySourceId['sfx-1'].map(issue => issue.code)).to.include('missing_clip');

    const config = projectToMidiConfig(project, {});
    expect(config.sfx['1']).to.include({
      clipId: null,
      clipType: 'stepPattern',
      disabled: true
    });
    expect(config.sfx['1'].note).to.equal(null);
    expect(config.sfx['1']).to.not.have.property('notes');
    expect(config.sfx['1']).to.not.have.property('arp');
  });

  it('reduces global modulation and lowers automation lanes into runtime position mappings', function() {
    let project = createMidiProjectFromMidiConfig({
      enabled: true,
      position: { mappings: [] },
      sfx: { '1': { name: 'skill-select', note: 60, velocity: 80, durationTicks: 4 } },
      triggers: {}
    });

    project = reduceMidiProject(project, {
      type: 'global.update',
      patch: {
        velocityRange: { ...project.global.velocityRange, default: 96 },
        density: { ...project.global.density, velocityBoost: 0.75 },
        envelope: { ...project.global.envelope, attack: 1.4 },
        position: { ...project.global.position, viewPan: true }
      }
    });
    project = reduceMidiProject(project, { type: 'automation.add', automation: { id: 'lane', target: 'note', axis: 'x', min: -7, max: 7 } });
    project = reduceMidiProject(project, { type: 'automation.update', automationId: 'lane', patch: { target: 'pan', axisOp: 'mul', min: -80, max: 80 } });
    project = reduceMidiProject(project, { type: 'automation.point.update', automationId: 'lane', pointIndex: 0, patch: { beat: 2, value: 10 } });

    expect(project.global.velocityRange.default).to.equal(96);
    expect(project.global.density.velocityBoost).to.equal(0.75);
    expect(project.global.envelope.attack).to.equal(1.4);
    expect(project.global.position.viewPan).to.equal(true);
    expect(project.automation[0]).to.include({ id: 'lane', target: 'pan', axis: 'x', axisOp: 'mul', min: -80, max: 80 });
    expect(project.automation[0].points[0]).to.deep.equal({ beat: 2, value: 10 });

    const config = projectToMidiConfig(project, {});
    expect(config.velocityRange.default).to.equal(96);
    expect(config.density.velocityBoost).to.equal(0.75);
    expect(config.envelope.attack).to.equal(1.4);
    expect(config.position.viewPan).to.equal(true);
    expect(config.position.mappings).to.deep.equal([
      { axis: 'x', axisOp: 'mul', target: 'pan', min: -80, max: 80, enabled: true }
    ]);
  });

  it('omits disabled automation lanes from runtime position mappings', function() {
    let project = createMidiProjectFromMidiConfig({
      enabled: true,
      position: { mappings: [] },
      sfx: { '1': { name: 'skill-select', note: 60, durationTicks: 4 } },
      triggers: {}
    });

    project = reduceMidiProject(project, {
      type: 'automation.add',
      automation: { id: 'lane-pan', target: 'pan', axis: 'x', min: -64, max: 64 }
    });
    project = reduceMidiProject(project, {
      type: 'automation.add',
      automation: { id: 'lane-timbre', target: 'timbre', axis: 'y', min: 0, max: 127 }
    });
    project = reduceMidiProject(project, {
      type: 'automation.update',
      automationId: 'lane-timbre',
      patch: { enabled: false }
    });

    const config = projectToMidiConfig(project, {});
    expect(config.position.mappings).to.have.lengthOf(1);
    expect(config.position.mappings[0]).to.include({
      axis: 'x',
      target: 'pan',
      enabled: true
    });
    expect(config.position.mappings.some(mapping => mapping.target === 'timbre')).to.equal(false);
  });

  it('exports, imports, and templates sanitized MIDI projects', function() {
    let project = createMidiProjectFromMidiConfig({
      enabled: true,
      input: { channel: 4 },
      sfx: { '1': { name: 'skill-select', note: 60, velocity: 80, durationTicks: 4 } },
      triggers: {}
    });
    project = reduceMidiProject(project, { type: 'track.update', trackId: 'track-1', patch: { channel: 3 } });
    project = reduceMidiProject(project, { type: 'source.mapping.update', sourceId: 'sfx-1', patch: { note: 72 } });

    const payload = createMidiProjectExportPayload(project, { exportedAt: 10 });
    expect(payload).to.include({ kind: MIDI_PROJECT_EXPORT_KIND, version: MIDI_PROJECT_VERSION, exportedAt: 10 });
    expect(payload.project.sources[0].mapping.note).to.equal(72);

    const text = stringifyMidiProjectExport(project, { exportedAt: 11 });
    const imported = importMidiProjectPayload(text);
    expect(imported.sources[0].mapping.note).to.equal(72);
    expect(imported.tracks[0].channel).to.equal(3);

    const template = createMidiProjectTemplate(project, {
      id: 'user-lead',
      name: 'Lead Template',
      now: 20
    });
    expect(template).to.include({ id: 'user-lead', name: 'Lead Template', createdAt: 20, updatedAt: 20 });
    expect(template.project).to.include({ enabled: false, templateId: 'user-lead' });
    expect(template.project.devices).to.deep.equal({ inputId: null, outputId: null, inputChannel: 4 });

    const templatePayload = createMidiProjectExportPayload(project, {
      asTemplate: true,
      id: 'template-export',
      name: 'Template Export',
      exportedAt: 30,
      now: 30
    });
    expect(templatePayload).to.include({ kind: MIDI_TEMPLATE_EXPORT_KIND, exportedAt: 30 });
    const importedTemplate = importMidiProjectPayload(templatePayload);
    expect(importedTemplate).to.include({ enabled: false, templateId: 'template-export' });
    expect(importedTemplate.sources[0].mapping.note).to.equal(72);

    expect(() => importMidiProjectPayload('{bad json')).to.throw('not valid JSON');
    expect(() => importMidiProjectPayload({ kind: MIDI_PROJECT_EXPORT_KIND })).to.throw('did not contain a project');
  });

  it('applies track velocity scale to clip mappings', function() {
    let project = createMidiProjectFromMidiConfig({
      enabled: true,
      sfx: { '1': { name: 'skill-select', note: 60 } },
      triggers: {}
    });
    project = reduceMidiProject(project, { type: 'track.update', trackId: 'track-1', patch: { velocityScale: 0.5 } });
    project = reduceMidiProject(project, { type: 'clip.add', clip: { id: 'riff', name: 'Riff', lengthSteps: 2 } });
    project = reduceMidiProject(project, { type: 'clip.step.update', clipId: 'riff', stepIndex: 0, patch: { note: 64, velocity: 90 } });
    project = reduceMidiProject(project, { type: 'source.clip.assign', sourceId: 'sfx-1', clipId: 'riff' });

    const config = projectToMidiConfig(project, {});
    expect(config.sfx['1']).to.include({ note: 64, velocity: 45, clipId: 'riff' });
  });

  it('detects duplicate runtime keys, invalid raw refs, disabled sources, and note range conflicts', function() {
    const report = detectMidiProjectConflicts({
      enabled: true,
      devices: { inputChannel: 99 },
      global: { noteRange: { min: 50, max: 70 } },
      tracks: [
        { id: 'track-1', name: 'Main', channel: 99, outputId: 'ghost-out' }
      ],
      clips: [
        { id: 'clip-a', name: 'Clip A', lengthSteps: 2, steps: [{ note: 64 }] }
      ],
      sources: [
        { id: 'dup-a', kind: 'sfx', sourceKey: '1', label: 'Duplicate A', trackId: 'track-1', enabled: true, mapping: { note: 120 } },
        { id: 'dup-b', kind: 'sfx', sourceKey: '1', label: 'Duplicate B', trackId: 'missing-track', enabled: true, mapping: {} },
        { id: 'clip-missing', kind: 'trigger', sourceKey: '5', label: 'Missing Clip', trackId: 'track-1', enabled: true, mode: 'clip', clipId: 'missing-clip' },
        { id: 'disabled', kind: 'sfx', sourceKey: '2', label: 'Disabled', trackId: 'track-1', enabled: false, mapping: { note: 60 } }
      ]
    }, { availableOutputIds: [] });

    const codes = report.issues.map(issue => issue.code);
    expect(report.ok).to.equal(false);
    expect(codes).to.not.include('track_output_ignored');
    expect(codes).to.include.members([
      'duplicate_source_key',
      'missing_track',
      'missing_clip',
      'invalid_input_channel',
      'invalid_track_channel',
      'invalid_track_output',
      'implicit_default_mapping',
      'note_out_of_range',
      'disabled_source'
    ]);
    expect(report.bySourceId['dup-a'].map(issue => issue.code)).to.include.members(['duplicate_source_key', 'note_out_of_range']);
    expect(report.bySourceId['dup-b'].map(issue => issue.code)).to.include.members(['duplicate_source_key', 'missing_track', 'implicit_default_mapping']);
    expect(report.bySourceId.disabled[0]).to.include({ severity: 'info', code: 'disabled_source' });
  });

  it('detects missing required project output conflicts', function() {
    const report = detectMidiProjectConflicts({
      enabled: true,
      devices: { outputId: null },
      tracks: [{ id: 'track-1', name: 'Main', channel: 1 }],
      sources: []
    }, { requireOutput: true });

    expect(report.ok).to.equal(true);
    expect(report.summary.warnings).to.equal(1);
    expect(report.issues[0]).to.include({
      severity: 'warning',
      code: 'missing_project_output'
    });
    expect(report.issues[0].path).to.deep.equal(['devices', 'outputId']);
    expect(report.bySourceId).to.deep.equal({});
    expect(report.byTrackId).to.deep.equal({});
  });

  it('detects muted, solo-hidden, empty clip, and note collapse conflicts', function() {
    const project = sanitizeMidiProject({
      global: { noteRange: { min: 60, max: 60 } },
      tracks: [
        { id: 'muted', name: 'Muted', mute: true },
        { id: 'lead', name: 'Lead', solo: true },
        { id: 'hidden', name: 'Hidden' }
      ],
      clips: [
        { id: 'empty', name: 'Empty', lengthSteps: 2, steps: [{ note: null }, { note: 65, probability: 0 }] },
        { id: 'wide', name: 'Wide', lengthSteps: 2, steps: [{ note: 59 }, { note: 61 }] }
      ],
      sources: [
        { id: 'muted-source', kind: 'sfx', sourceKey: '1', label: 'Muted Source', trackId: 'muted', enabled: true, mapping: { note: 60 } },
        { id: 'hidden-source', kind: 'sfx', sourceKey: '2', label: 'Hidden Source', trackId: 'hidden', enabled: true, mapping: { note: 60 } },
        { id: 'empty-clip-source', kind: 'sfx', sourceKey: '3', label: 'Empty Clip Source', trackId: 'lead', enabled: true, mode: 'clip', clipId: 'empty' },
        { id: 'wide-clip-source', kind: 'sfx', sourceKey: '4', label: 'Wide Clip Source', trackId: 'lead', enabled: true, mode: 'clip', clipId: 'wide' }
      ]
    });

    const report = detectMidiProjectConflicts(project);
    expect(report.bySourceId['muted-source'].map(issue => issue.code)).to.include('track_muted');
    expect(report.bySourceId['hidden-source'].map(issue => issue.code)).to.include('track_solo_hidden');
    expect(report.bySourceId['empty-clip-source'].map(issue => issue.code)).to.include('silent_clip');
    expect(report.bySourceId['wide-clip-source'].map(issue => issue.code)).to.include.members(['note_out_of_range', 'note_range_collapse']);
  });

  it('adapts projects back to MIDI config with direct mappings, channels, mute, and solo state', function() {
    const project = sanitizeMidiProject({
      enabled: true,
      devices: { inputChannel: 7 },
      transport: { bpmBase: 140, timeSignature: { beats: 3, unit: 4 }, quantize: '1/8', swing: 0.2 },
      global: {
        scale: { name: 'major', root: 2, degrees: [0, 2, 4, 5, 7, 9, 11] },
        noteRange: { min: 24, max: 96 },
        velocityRange: { min: 10, max: 127, default: 90 },
        durationTicks: { min: 1, max: 64, default: 8 },
        mpe: { enabled: false },
        limits: { maxEventsPerSecond: 50 },
        reverse: { allNotesOffOnToggle: true }
      },
      tracks: [
        { id: 'drums', name: 'Drums', channel: 10, mute: true, priority: 3 },
        { id: 'lead', name: 'Lead', channel: 2, solo: true, priority: 9, velocityScale: 0.5, voiceBudget: 4 },
        { id: 'hidden', name: 'Hidden', channel: 4 }
      ],
      sources: [
        { id: 'sfx-1', kind: 'sfx', sourceKey: '1', label: 'Skill', trackId: 'drums', enabled: true, mapping: { note: 60, durationTicks: 4 } },
        { id: 'sfx-2', kind: 'sfx', sourceKey: '2', label: 'Lead', trackId: 'lead', enabled: true, mapping: { notes: [64, 67], velocity: 100 } },
        { id: 'trigger-5', kind: 'midiFlag', sourceKey: '5', label: 'Flag', trackId: 'hidden', enabled: true, mapping: { degree: 2, octave: 4 } }
      ]
    });

    const config = projectToMidiConfig(project, {
      sfx: { old: { note: 1 } },
      triggers: { old: { note: 2 } },
      input: { enabled: false, channel: 1 }
    });

    expect(config.enabled).to.equal(true);
    expect(config.input.enabled).to.equal(true);
    expect(config.input.channel).to.equal(7);
    expect(config.timing.bpmBase).to.equal(140);
    expect(config.timing.timeSignature).to.deep.equal({ beats: 3, unit: 4 });
    expect(config.timing).to.include({ quantize: '1/8', swing: 0.2 });
    expect(config.scale.name).to.equal('major');
    expect(config.noteRange).to.deep.equal({ min: 24, max: 96 });
    expect(config.sfx).to.not.have.property('old');
    expect(config.triggers).to.not.have.property('old');
    expect(config.sfx['1']).to.include({ note: 60, durationTicks: 4, channel: 10, priority: 3, voiceBudget: 32, disabled: true });
    expect(config.sfx['2']).to.include({ velocity: 50, channel: 2, priority: 9, voiceBudget: 4 });
    expect(config.sfx['2']).to.not.have.property('disabled');
    expect(config.sfx['2'].notes).to.deep.equal([64, 67]);
    expect(config.triggers['5']).to.include({ degree: 2, octave: 4, channel: 4, voiceBudget: 32, disabled: true });
  });
});
