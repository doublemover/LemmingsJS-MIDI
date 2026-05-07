export async function installWebMidiStub(page, { withDevices = true, permission = 'granted' } = {}) {
  await page.addInitScript(({ withDevices, permission }) => {
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

    let midiAccess = null;
    const inputs = new Map();
    const outputs = new Map();
    const listeners = new Map();

    const emitAccessEvent = (eventName, event) => {
      for (const handler of listeners.get(eventName) || []) handler(event);
      const prop = `on${eventName}`;
      if (typeof midiAccess?.[prop] === 'function') midiAccess[prop](event);
    };

    const emitStateChange = (port) => {
      if (!midiAccess) return;
      const event = { port, timeStamp: performance.now() };
      emitAccessEvent('statechange', event);
    };

    const addPort = (type, id, name, { emit = true } = {}) => {
      const target = type === 'input' ? inputs : outputs;
      const existing = target.get(id);
      if (existing) {
        existing.state = 'connected';
        existing.connection = 'open';
        if (emit) emitStateChange(existing);
        return existing;
      }
      const port = createPort(type, id, name);
      target.set(id, port);
      if (emit) emitStateChange(port);
      return port;
    };

    const removePort = (type, id) => {
      const target = type === 'input' ? inputs : outputs;
      const port = target.get(id);
      if (!port) return false;
      target.delete(id);
      port.state = 'disconnected';
      port.connection = 'pending';
      emitStateChange(port);
      return true;
    };

    if (withDevices) {
      addPort('input', 'pw-input-1', 'Playwright Input', { emit: false });
      addPort('output', 'pw-output-1', 'Playwright Output', { emit: false });
    }

    const requestMIDIAccess = async () => {
      if (permission === 'denied') {
        const error = new Error('Permission denied');
        error.name = 'NotAllowedError';
        return Promise.reject(error);
      }
      midiAccess = {
        inputs,
        outputs,
        sysexEnabled: false,
        onstatechange: null,
        addEventListener(eventName, handler) {
          const list = listeners.get(eventName) || [];
          list.push(handler);
          listeners.set(eventName, list);
        },
        removeEventListener(eventName, handler) {
          const list = listeners.get(eventName) || [];
          listeners.set(eventName, list.filter(entry => entry !== handler));
        }
      };
      return midiAccess;
    };

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
      },
      disconnectInput(inputId = 'pw-input-1') {
        return removePort('input', inputId);
      },
      reconnectInput(inputId = 'pw-input-1', name = 'Playwright Input') {
        return !!addPort('input', inputId, name);
      },
      disconnectOutput(outputId = 'pw-output-1') {
        return removePort('output', outputId);
      },
      reconnectOutput(outputId = 'pw-output-1', name = 'Playwright Output') {
        return !!addPort('output', outputId, name);
      },
      listDevices() {
        return {
          inputs: Array.from(inputs.values()).map(input => ({ id: input.id, name: input.name, state: input.state })),
          outputs: Array.from(outputs.values()).map(output => ({ id: output.id, name: output.name, state: output.state }))
        };
      }
    };
  }, { withDevices, permission });
}
