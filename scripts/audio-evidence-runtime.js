import { chromium, firefox, webkit } from '@playwright/test';

const LOCAL_AUDIO_SOURCES = Object.freeze([
  'js/app/midi-ui/browserNotePreview.js', 'js/app/midi-ui/nativeOscillatorBackend.js',
  'js/app/midi-ui/TimedControlTimeline.js', 'js/app/midi-ui/SmoothedAudioParameter.js',
  'js/app/midi-ui/AudioObservationLeases.js', 'js/midi/scheduler/LocalAudioVoiceBudget.js'
]);
const readAudioEvidenceOptions = (args = process.argv.slice(2)) => {
  const value = name => args.find(arg => arg.startsWith('--' + name + '='))?.slice(name.length + 3);
  const browserName = value('browser') || 'chromium', channel = value('channel') || null, executablePath = value('executable') || null;
  if (!['chromium', 'firefox', 'webkit'].includes(browserName)) throw new Error('Audio evidence browser must be chromium, firefox or webkit.');
  if (channel && browserName !== 'chromium') throw new Error('--channel is supported only for Chromium browsers.');
  if (channel && executablePath) throw new Error('Select either --channel or --executable.');
  return Object.freeze({ browserName, channel, executablePath });
};
const launchAudioEvidenceBrowser = async (options = readAudioEvidenceOptions()) => {
  const type = { chromium, firefox, webkit }[options.browserName];
  if (!type) throw new Error('Unknown audio evidence browser.');
  const browser = await type.launch({ headless: true,
    ...(options.browserName === 'chromium' ? { chromiumSandbox: true, args: ['--mute-audio'] } : {}),
    ...(options.channel ? { channel: options.channel } : {}),
    ...(options.executablePath ? { executablePath: options.executablePath } : {}) });
  return { browser, environment: Object.freeze({ browserName: options.browserName, browserVersion: browser.version(),
    channel: options.channel, customExecutable: !!options.executablePath, measurementScope: 'digital-offline',
    chromiumSandbox: options.browserName === 'chromium' ? true : null,
    realtime: 'not-run', listened: 'not-run', physicalLoopback: 'not-run' }) };
};

export { LOCAL_AUDIO_SOURCES, readAudioEvidenceOptions, launchAudioEvidenceBrowser };
