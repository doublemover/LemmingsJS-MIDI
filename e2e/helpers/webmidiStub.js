export async function installWebMidiStub(page, { withDevices = true } = {}) {
  await page.addInitScript(({ withDevices }) => {
    const createPort = (type, id, name) => {
      const listeners = new Map();
      const port = {
        id,
        name,
        manufacturer: 'Playwright',
        type,
        state: 'connected',
        connection: 'open',
        onstatechange: null,
        onmidimessage: null,
        addEventListener: (eventName, handler) => {
          const list = listeners.get(eventName) || [];
          list.push(handler);
          listeners.set(eventName, list);
        },
        removeEventListener: (eventName, handler) => {
          const list = listeners.get(eventName) || [];
          listeners.set(eventName, list.filter(entry => entry !== handler));
        },
        open: async () => {},
        close: async () => {},
        send: () => {},
        clear: () => {},
        _emit(eventName, event) {
          for (const handler of listeners.get(eventName) || []) handler(event);
          const prop = `on${eventName}`;
          if (typeof port[prop] === 'function') port[prop](event);
        }
      };
      return port;
    };

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

    window.__WEBMIDI_STUB__ = {
      sendInput(data, inputId = 'pw-input-1') {
        const input = inputs.get(inputId);
        if (!input) return false;
        input._emit('midimessage', {
          data: new Uint8Array(data),
          receivedTime: performance.now()
        });
        return true;
      },
      sendNoteOn(note, velocity = 100, channel = 1, inputId = 'pw-input-1') {
        return this.sendInput([0x90 + Math.max(0, Math.min(15, channel - 1)), note, velocity], inputId);
      },
      sendNoteOff(note, velocity = 0, channel = 1, inputId = 'pw-input-1') {
        return this.sendInput([0x80 + Math.max(0, Math.min(15, channel - 1)), note, velocity], inputId);
      }
    };
  }, { withDevices });
}
