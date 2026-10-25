import { expect } from 'chai';
import { encodeRecoveryProject, decodeRecoveryProject } from '../js/app/procgen/workstation/ProcgenRecoveryProjectPages.js';
import { sealMidiProjectSnapshot } from '../js/midi/project/MidiProjectSnapshot.js';

describe('authored recovery project layout', () => {
  it('pages fields and lanes separately and round-trips the complete authored value', async () => {
    const project = sealMidiProjectSnapshot({ name: 'project', global: { root: 3 }, procgen: { revision: 1, physicalGraph: { nodes: [] }, lanes: [{ id: 'a' }, { id: 'b' }] } });
    const pages = [], layout = await encodeRecoveryProject(project, async (value, kind, maxBytes, peak, reusable) => { pages.push({ value, kind, maxBytes, peak, reusable }); return { key: String(pages.length - 1) }; });
    expect(pages.length).to.equal(4); expect(pages.every(page => page.reusable)).to.equal(true);
    expect(await decodeRecoveryProject(layout, async ref => pages[Number(ref.key)].value)).to.deep.equal(project);
  });
  it('rejects ambiguous fields and prototype pollution without publishing a partial project', async () => {
    const valid = { schema: 'procgen-recovery-project/v1', fields: [], procgen: { fields: [], lanes: [] } };
    for (const entry of [{ key: '__proto__', value: 1 }, { key: 'name', page: {}, value: 'ambiguous' }, { key: 'procgen', value: null }]) {
      let error; try { await decodeRecoveryProject({ ...valid, fields: [entry] }, async () => ({})); } catch (value) { error = value; } expect(error).to.exist;
    }
  });
});
