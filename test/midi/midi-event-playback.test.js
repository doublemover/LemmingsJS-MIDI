import { expect } from 'chai';
import { createMidiEventPlayback } from '../../js/app/midi-ui/midiEventPlayback.js';
import { TestDocument } from '../helpers/test-dom.js';

describe('audible event row playback', function() {
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
