export async function installWebMidiStub(page, { withDevices = true } = {}) {
  await page.addInitScript(({ withDevices }) => {
    const createPort = (type, id, name) => ({
      id,
      name,
      manufacturer: 'Playwright',
      type,
      state: 'connected',
      connection: 'open',
      onstatechange: null,
      onmidimessage: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      open: async () => {},
      close: async () => {},
      send: () => {},
      clear: () => {}
    });

    const inputs = new Map();
    const outputs = new Map();
    if (withDevices) {
      const input = createPort('input', 'pw-input-1', 'Playwright Input');
      const output = createPort('output', 'pw-output-1', 'Playwright Output');
      inputs.set(input.id, input);
      outputs.set(output.id, output);
    }

    const requestMIDIAccess = async () => ({
      inputs,
      outputs,
      sysexEnabled: false,
      onstatechange: null,
      addEventListener: () => {},
      removeEventListener: () => {}
    });

    try {
      Object.defineProperty(navigator, 'requestMIDIAccess', {
        configurable: true,
        value: requestMIDIAccess
      });
    } catch (error) {
      navigator.requestMIDIAccess = requestMIDIAccess;
    }
  }, { withDevices });
}
