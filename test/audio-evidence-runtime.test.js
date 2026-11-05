import { expect } from 'chai';
import { readAudioEvidenceOptions as launchOptions } from '../scripts/audio-evidence-browser.js';
import { LOCAL_AUDIO_SOURCES, readAudioEvidenceOptions, startAudioEvidenceServer } from '../scripts/audio-evidence-runtime.js';

describe('bounded audio evidence source inventory and independent launch options', () => {
  it('retains the legacy public exports and complete current first-party source graph', () => {
    expect(readAudioEvidenceOptions).to.equal(launchOptions);
    expect(Object.isFrozen(LOCAL_AUDIO_SOURCES)).to.equal(true); expect(new Set(LOCAL_AUDIO_SOURCES).size).to.equal(LOCAL_AUDIO_SOURCES.length);
    expect(LOCAL_AUDIO_SOURCES.length).to.be.at.most(512);
    expect(LOCAL_AUDIO_SOURCES).to.include.members(['js/app/midi-ui/OwnedSourceSeed.js', 'js/midi/content/InstrumentActorLocks.js']);
    expect(readAudioEvidenceOptions([])).to.deep.equal({ browserName: 'chromium', channel: null, executablePath: null });
    for (const args of [['--browser=other'], ['--browser=firefox', '--channel=chrome'], ['--channel=chrome', '--executable=browser']]) expect(() => readAudioEvidenceOptions(args)).to.throw();
  });
  it('serves the actual admitted module and refuses paths outside its source inventory', async () => {
    const server = await startAudioEvidenceServer();
    try {
      const admitted = await fetch(server.origin + '/js/app/midi-ui/OwnedSourceSeed.js'); expect(admitted.status).to.equal(200); expect(await admitted.text()).to.include('resolveOwnedSourceSeed');
      expect((await fetch(server.origin + '/package.json')).status).to.equal(404);
      expect((await fetch(server.origin + '/js/app/midi-ui/OwnedSourceSeed.js', { method: 'POST' })).status).to.equal(404);
    } finally { await server.close(); }
  });
});
