import { expect } from 'chai';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { createProtocolMetadata } from '../mcp/server.js';

const loadProtocolMetadataWithEnv = async (envValue) => {
  const previous = process.env.LEMMINGS_ROLLOUT_MCP_DOTTED_FALLBACK;
  if (envValue == null) {
    delete process.env.LEMMINGS_ROLLOUT_MCP_DOTTED_FALLBACK;
  } else {
    process.env.LEMMINGS_ROLLOUT_MCP_DOTTED_FALLBACK = envValue;
  }
  try {
    const serverUrl = pathToFileURL(path.resolve('mcp/server.js')).href;
    const mod = await import(`${serverUrl}?protocol-test=${envValue ?? 'default'}-${Date.now()}`);
    return mod.createProtocolMetadata();
  } finally {
    if (previous == null) {
      delete process.env.LEMMINGS_ROLLOUT_MCP_DOTTED_FALLBACK;
    } else {
      process.env.LEMMINGS_ROLLOUT_MCP_DOTTED_FALLBACK = previous;
    }
  }
};

describe('mcp server protocol metadata', function () {
  it('describes actual supported tool-name forms and unsupported options', function () {
    const protocol = createProtocolMetadata();
    expect(protocol.acceptedToolNameForms).to.include('underscore');
    expect(protocol.acceptedToolNameForms.includes('dotted')).to.equal(protocol.dottedFallbackEnabled);
    expect(protocol.legacyAliasesEnabled).to.equal(true);
    expect(protocol.unsupportedOptions.spectatorOpenBrowser).to.equal(true);
  });

  it('tracks dotted fallback rollout state in accepted tool-name forms', async function () {
    const enabled = await loadProtocolMetadataWithEnv('true');
    expect(enabled.dottedFallbackEnabled).to.equal(true);
    expect(enabled.acceptedToolNameForms).to.deep.equal(['underscore', 'dotted']);

    const disabled = await loadProtocolMetadataWithEnv('false');
    expect(disabled.dottedFallbackEnabled).to.equal(false);
    expect(disabled.acceptedToolNameForms).to.deep.equal(['underscore']);
  });
});
