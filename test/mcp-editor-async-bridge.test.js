import { expect } from 'chai';
import { createServerHelpers } from '../mcp/serverHelpers.js';

describe('MCP async editor bridge', () => {
  it('awaits editor results and catches rejected operations before serialization', async () => {
    const previous = globalThis.window;
    globalThis.window = { __E2E__: {
      editorApply: async value => ({ ok: true, resources: [value] }),
      reject: async () => { throw new Error('async editor failure'); }
    } };
    try {
      const session = { page: { evaluate: async (callback, args) => JSON.parse(JSON.stringify(await callback(args))) } };
      const { callE2E } = createServerHelpers({ skillNames: [] });
      expect(await callE2E(session, 'editorApply', 'level.nxlv')).to.deep.equal({ ok: true, value: { ok: true, resources: ['level.nxlv'] } });
      expect(await callE2E(session, 'reject')).to.deep.equal({ ok: false, error: 'Error: async editor failure' });
    } finally {
      if (previous === undefined) delete globalThis.window;
      else globalThis.window = previous;
    }
  });
});
