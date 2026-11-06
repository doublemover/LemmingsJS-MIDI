import { expect } from 'chai';
import { createOwnedAudioListeners } from '../../js/app/midi-ui/OwnedAudioListeners.js';

describe('captured native audio listener ownership', () => {
  it('invalidates callbacks before independently attempting every captured native removal', async () => {
    const listeners = new Map(), removed = [], owner = createOwnedAudioListeners(); let callbacks = 0;
    const target = { addEventListener(type, callback) { listeners.set(type, callback); }, removeEventListener(type) { removed.push(type); listeners.get(type)(); if (type === 'a') throw Error('refused'); listeners.delete(type); } };
    owner.add(target, 'a', () => callbacks++); owner.add(target, 'b', () => callbacks++); listeners.get('a')();
    const receipt = owner.dispose(); await receipt.completion;
    expect(removed).to.deep.equal(['a', 'b']); expect(callbacks).to.equal(1); expect(receipt.outcome).not.to.equal('complete');
    listeners.get('a')(); expect(callbacks).to.equal(1); expect(owner.dispose()).to.equal(receipt);
  });
  it('captures native methods and accounts for partially throwing registration', () => {
    let callback, removed = 0; const owner = createOwnedAudioListeners(), target = {
      addEventListener(type, value) { callback = value; throw Error('partial native registration'); }, removeEventListener() { removed++; } };
    expect(() => owner.add(target, 'statechange', () => {})).to.throw('partial native');
    target.removeEventListener = () => { throw Error('mutated slot'); };
    expect(owner.dispose().outcome).to.equal('complete'); expect(removed).to.equal(1); expect(callback).to.be.a('function');
  });
  it('refuses unretirable or oversized registrations without invoking native add', () => {
    const owner = createOwnedAudioListeners(); let adds = 0;
    expect(owner.add({}, 'statechange', () => {})).to.equal(false);
    expect(() => owner.add({ addEventListener() { adds++; } }, 'statechange', () => {})).to.throw('removable'); expect(adds).to.equal(0);
    const target = { addEventListener() { adds++; }, removeEventListener() {} };
    for (let i = 0; i < 16; i++) owner.add(target, 'change', () => {});
    expect(() => owner.add(target, 'change', () => {})).to.throw('Invalid'); expect(adds).to.equal(16); owner.dispose();
    expect(() => owner.add(target, 'change', () => {})).to.throw('Invalid');
  });
});
