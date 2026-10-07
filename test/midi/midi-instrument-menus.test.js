import { expect } from 'chai';
import { createMidiInstrumentMenus } from '../../js/app/midi-ui/midiInstrumentMenus.js';
import { TestDocument } from '../helpers/test-dom.js';

const eventTarget = target => {
  const listeners = new Map();
  target.addEventListener = (name, handler) => {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name).add(handler);
  };
  target.removeEventListener = (name, handler) => listeners.get(name)?.delete(handler);
  target.emit = (name, fields = {}) => {
    const event = { type: name, prevented: false, stopped: false,
      preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...fields };
    for (const handler of listeners.get(name) || []) handler(event);
    return event;
  };
  target.listenerCount = () => [...listeners.values()].reduce((sum, handlers) => sum + handlers.size, 0);
  return target;
};

const fixture = () => {
  const document = eventTarget(new TestDocument()), window = eventTarget({});
  const root = eventTarget(document.createElement('nav'));
  const addMenu = (label, labels) => {
    const menu = document.createElement('details'), summary = document.createElement('summary'), panel = document.createElement('div');
    summary.textContent = label; menu.open = false;
    menu.append(summary, panel); root.append(menu);
    const buttons = labels.map(label => { const button = document.createElement('button'); button.textContent = label; panel.append(button); return button; });
    menu.querySelector = selector => selector === 'summary' ? summary : null;
    menu.querySelectorAll = selector => selector === 'button' ? buttons : [];
    return { menu, summary, buttons };
  };
  const file = addMenu('File', ['Import project', 'Export project', 'Save template']);
  const edit = addMenu('Edit', ['Undo sound edit', 'Redo sound edit']);
  const view = addMenu('View', ['Focus', 'Split', 'Overlay']);
  const midi = addMenu('MIDI', ['Device connections', 'Panic all notes']);
  edit.buttons.forEach(button => { button.disabled = true; });
  const controller = createMidiInstrumentMenus({ root, document, window });
  const key = (target, key, extra) => root.emit('keydown', { target, key, ...extra });
  return { document, window, root, file, edit, view, midi, controller, key };
};

describe('instrument menu keyboard and dismissal lifecycle', function() {
  it('opens from the keyboard, skips unavailable actions and moves across an empty menu', function() {
    const f = fixture(); f.file.summary.focus();
    expect(f.key(f.file.summary, 'ArrowDown')).to.include({ prevented: true, stopped: true });
    expect(f.document.activeElement).to.equal(f.file.buttons[0]);
    f.file.buttons[1].disabled = true;
    f.key(f.document.activeElement, 'ArrowDown');
    expect(f.document.activeElement).to.equal(f.file.buttons[2]);
    f.key(f.document.activeElement, 'ArrowRight');
    expect(f.file.menu.open).to.equal(false); expect(f.edit.menu.open).to.equal(true);
    expect(f.document.activeElement).to.equal(f.edit.summary);
    f.key(f.document.activeElement, 'ArrowRight');
    expect(f.edit.menu.open).to.equal(false); expect(f.view.menu.open).to.equal(true);
    expect(f.document.activeElement).to.equal(f.view.buttons[0]);
    f.controller.dispose();
  });

  it('supports reverse entry, endpoint navigation and label search without stealing modified keys', function() {
    const f = fixture(); f.key(f.file.summary, 'ArrowUp');
    expect(f.document.activeElement).to.equal(f.file.buttons[2]);
    f.key(f.document.activeElement, 'Home'); expect(f.document.activeElement).to.equal(f.file.buttons[0]);
    f.key(f.document.activeElement, 'e'); expect(f.document.activeElement).to.equal(f.file.buttons[1]);
    f.key(f.document.activeElement, 'End'); expect(f.document.activeElement).to.equal(f.file.buttons[2]);
    expect(f.key(f.document.activeElement, 'ArrowLeft', { ctrlKey: true }).prevented).to.equal(false);
    expect(f.document.activeElement).to.equal(f.file.buttons[2]);
    f.controller.dispose();
  });

  it('Escape returns to the owning summary and does not close the whole workbench', function() {
    const f = fixture(); f.key(f.midi.summary, 'ArrowDown');
    const event = f.key(f.document.activeElement, 'Escape');
    expect(event.stopped).to.equal(true); expect(f.midi.menu.open).to.equal(false);
    expect(f.document.activeElement).to.equal(f.midi.summary);
    f.controller.dispose();
  });

  it('returns action focus from hidden controls while preserving a destination focused by the action', function() {
    const f = fixture(); f.key(f.file.summary, 'ArrowDown');
    const icon = f.document.createElement('span'); f.file.buttons[0].append(icon);
    f.root.emit('click', { target: icon });
    expect(f.file.menu.open).to.equal(false); expect(f.document.activeElement).to.equal(f.file.summary);
    f.key(f.midi.summary, 'ArrowDown');
    const destination = f.document.createElement('input'); destination.focus();
    f.root.emit('click', { target: f.midi.buttons[0] });
    expect(f.midi.menu.open).to.equal(false); expect(f.document.activeElement).to.equal(destination);
    f.edit.buttons[0].disabled = false; f.key(f.edit.summary, 'ArrowDown');
    f.edit.buttons[0].disabled = true;
    f.root.emit('click', { target: f.edit.buttons[0] });
    expect(f.edit.menu.open).to.equal(false); expect(f.document.activeElement).to.equal(f.edit.summary);
    f.controller.dispose();
  });

  it('closes on outside pointer, focus departure, visibility changes and window blur without moving outside focus', function() {
    const f = fixture(), outside = f.document.createElement('button');
    f.key(f.file.summary, 'ArrowDown'); outside.focus();
    f.document.emit('pointerdown', { target: outside });
    expect(f.file.menu.open).to.equal(false); expect(f.document.activeElement).to.equal(outside);
    f.key(f.view.summary, 'ArrowDown'); f.root.emit('focusout', { relatedTarget: f.view.buttons[1] });
    expect(f.view.menu.open).to.equal(true);
    f.root.emit('focusout', { relatedTarget: outside }); expect(f.view.menu.open).to.equal(false);
    f.key(f.file.summary, 'ArrowDown'); f.root.emit('focusin', { target: f.edit.summary });
    expect(f.file.menu.open).to.equal(false);
    f.key(f.midi.summary, 'ArrowDown'); f.window.emit('blur'); expect(f.midi.menu.open).to.equal(false);
    f.key(f.file.summary, 'ArrowDown'); f.controller.close(); expect(f.file.menu.open).to.equal(false);
    f.controller.dispose();
  });

  it('keeps native summary activation and releases every listener before rebinding', function() {
    const f = fixture(); f.file.menu.open = true;
    const event = f.root.emit('click', { target: f.view.summary });
    expect(event.prevented).to.equal(false); expect(f.file.menu.open).to.equal(false);
    expect(f.view.menu.open).to.equal(false);
    f.controller.dispose();
    expect(f.root.listenerCount() + f.document.listenerCount() + f.window.listenerCount()).to.equal(0);
    const second = createMidiInstrumentMenus(f);
    f.key(f.file.summary, 'ArrowDown'); expect(f.file.menu.open).to.equal(true);
    second.dispose(); expect(f.file.menu.open).to.equal(false);
  });
});
