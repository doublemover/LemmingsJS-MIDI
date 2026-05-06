const config = {
  name: 'midi',
  route: '/',
  async setup(page) {
    await page.waitForSelector('#midiEnabledToggle', { state: 'visible' });
    await page.locator('#midiEnabledToggle').check();
    await page.waitForSelector('#controlRight', { state: 'visible' });
    await page.waitForSelector('#midiEventList details');
  },
  targets: [
    { name: 'midi-left-controls', type: 'selector', selector: '#controlLeft' },
    { name: 'midi-right-controls', type: 'selector', selector: '#controlRight' },
    { name: 'midi-active-events', type: 'selector', selector: '#midiTabEvents' },
    { name: 'midi-canvas', type: 'runtimeRect', id: 'canvas' },
    { name: 'midi-viewport', type: 'viewport' }
  ],
  probes: [
    {
      name: 'midi-left-controls',
      selector: '#controlLeft',
      checks: ['horizontalOverflow', 'verticalOverflow', 'unexpectedScrollbar']
    },
    {
      name: 'midi-right-controls',
      selector: '#controlRight',
      checks: ['horizontalOverflow', 'verticalOverflow', 'unexpectedScrollbar']
    }
  ]
};

export default config;
