import { expect } from 'chai';
import { EditorTools, EDITOR_TOOL_ORDER } from '../../js/editor/EditorTools.js';

describe('EditorTools', () => {
  it('exposes a stable tool order', () => {
    expect(EditorTools.SELECT).to.equal('select');
    expect(EDITOR_TOOL_ORDER).to.deep.equal([
      EditorTools.SELECT,
      EditorTools.TERRAIN,
      EditorTools.GADGET,
      EditorTools.TRIGGER,
      EditorTools.MIDI_FLAG,
      EditorTools.ENTRANCE,
      EditorTools.EXIT,
      EditorTools.STEEL,
      EditorTools.BRUSH,
      EditorTools.ERASER
    ]);
  });
});
