import { expect } from 'chai';
import { createProtocolMetadata } from '../mcp/server.js';

describe('mcp server protocol metadata', function () {
  it('describes the hard-cut protocol surface', function () {
    const protocol = createProtocolMetadata();
    expect(Object.keys(protocol).sort()).to.deep.equal([
      'acceptedToolNameForms',
      'lemmingDeltaFields',
      'schemaFrozenAt',
      'skillNames',
      'unsupportedOptions',
      'version'
    ]);
    expect(protocol.acceptedToolNameForms).to.deep.equal(['underscore']);
    expect(protocol.unsupportedOptions.spectatorOpenBrowser).to.equal(true);
  });
});
