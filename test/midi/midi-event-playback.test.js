import { expect } from 'chai';
import { createMidiEventPlayback, getMidiEventPlaybackEnvelope } from '../../js/app/midi-ui/midiEventPlayback.js';
import { TestDocument } from '../helpers/test-dom.js';

describe('audible event row playback', function() {
  it('follows the actual decay, profile release, early-release level and zero-sustain tail rather than a fixed gate envelope', function() {
    const note = { phase: 'start', startMs: 1000, releaseMs: 8940, endMs: 9000, durationMs: 120, attackMs: 6, decayMs: 50, sustain: 0.82, releaseDurationMs: 60, mixLatencyMs: 6 };
    expect(getMidiEventPlaybackEnvelope(note)).to.deep.equal({ startMs: 1006, endMs: 1186,
      points: [{ time: 1000, level: 0 }, { time: 1006, level: 1 }, { time: 1056, level: 0.82 }, { time: 1120, level: 0.82 }, { time: 1180, level: 0 }] });
    const early = getMidiEventPlaybackEnvelope({ ...note, phase: 'release', releaseMs: 1004, endMs: 1064, releaseLevel: 2 / 3 });
    expect(early.endMs).to.equal(1070); expect(early.points).to.deep.equal([{ time: 1000, level: 0 }, { time: 1004, level: 2 / 3 }, { time: 1064, level: 0 }]);
    const percussion = getMidiEventPlaybackEnvelope({ ...note, durationMs: 1200, attackMs: 1, decayMs: 55, sustain: 0, releaseMs: 1075, endMs: 1090, releaseDurationMs: 15 });
    expect(percussion.endMs).to.equal(1062); expect(percussion.points).to.deep.equal([{ time: 1000, level: 0 }, { time: 1001, level: 1 }, { time: 1056, level: 0 }]);
  });
  it('keeps reduced-motion onset/fade timing and actual cell metadata without horizontal motion', function() {
    const document = new TestDocument(), row = document.createElement('button'); row.dataset.gameEventId = '20';
    const create = document.createElement.bind(document), animations = [];
    document.createElement = tag => { const node = create(tag); node.remove = () => row.removeChild(node); node.animate = (frames, options) => {
      const animation = { frames, options, cancel() {} }; animations.push(animation); return animation;
    }; return node; };
    const display = createMidiEventPlayback({ document, window: { performance: { now: () => 1000 }, matchMedia: () => ({ matches: true }) }, getRows: () => [row] });
    display.onPlayback({ id: 1, owner: 'game', sfxId: 20, phase: 'start', note: 48, velocity: 127, startMs: 1100, releaseMs: 8940, endMs: 9000,
      durationMs: 120, attackMs: 6, decayMs: 50, sustain: 0.82, releaseDurationMs: 60, mixLatencyMs: 6, stepIndex: 1, stepCount: 3 });
    expect(row.children[0].dataset).to.include({ playbackCell: '1', playbackCells: '3' }); expect(row.children[0].title).to.include('Cell 2 of 3 actually dispatched');
    expect(animations[0].options).to.include({ delay: 106, duration: 180, fill: 'both' });
    expect(animations[0].frames.every(frame => frame.transform === 'translateX(0px)')).to.equal(true);
    expect(animations[0].frames.map(frame => frame.opacity)).to.deep.equal([0, 1, 0.82, 0.82, 0]); display.dispose();
  });

  it('uses actual pitches and elapsed audio time, then fades at release and cleans on panic', function() {
    const document = new TestDocument(), row = document.createElement('button'); row.dataset.gameEventId = '20';
    let reads = 0; row.getBoundingClientRect = () => { reads += 1; return { width: 200 }; };
    const animations = [];
    const create = document.createElement.bind(document);
    document.createElement = tag => { const node = create(tag); node.animate = (frames, options) => { const animation = { frames, options, cancelled: false, cancel() { this.cancelled = true; } }; animations.push(animation); return animation; }; node.remove = () => row.removeChild(node); return node; };
    const display = createMidiEventPlayback({ document, window: { performance: { now: () => 1150 } }, getRows: () => [row] });
    const note = { id: 1, owner: 'game', sfxId: 20, phase: 'start', note: 69, velocity: 127, startMs: 1000, endMs: 9000, releaseMs: 8960, attackMs: 8, sustain: 1, durationMs: 400 };
    display.onPlayback(note);
    expect(row.children[0].textContent).to.equal('A4'); expect(animations[0].options).to.include({ delay: -150, duration: 440 });
    expect(animations[0].frames.at(-1)).to.include({ transform: 'translateX(172px)', opacity: 0 });
    display.onPlayback({ ...note, phase: 'release', releaseMs: 1200, endMs: 1240 });
    expect(animations[0].cancelled).to.equal(true); expect(animations[1].options.duration).to.equal(240);
    expect(reads).to.equal(2);
    display.onPlayback({ ...note, phase: 'end' }); expect(row.children).to.have.length(0); display.dispose();
  });
});
