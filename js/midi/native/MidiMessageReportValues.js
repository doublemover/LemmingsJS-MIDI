const addressOf = (scope, packet, kind, index = '') => [scope.connectionEpoch, scope.inputGrant, scope.ciEpoch, scope.ingressEpoch, scope.peerMuid, packet.group, packet.channel ?? '-', kind, index].join(':');
export function createMidiMessageReportValues({ scope, categories, maximumValues = 4096 }) {
  const values = new Map(), channels = new Map(), quarterFrames = new Set();
  const source = event => Object.freeze({ sequence: event.sequence, sourceTimestampNs: event.sourceTimestampNs, sourceClockDomain: event.sourceClockDomain, arrivalMonoUs: event.arrivalMonoUs });
  const put = (event, kind, index, value, wireBits, extra = {}) => {
    const packet = event.packet, address = addressOf(scope, packet, kind, index), previous = values.get(address);
    if (previous && (previous.value !== value || previous.wireBits !== wireBits)) {
      if (!(previous.wireBits === 7 && wireBits === 14 && previous.value === value >>> 7)) throw new Error('Conflicting state values during isolated report');
    }
    if (!previous && values.size >= maximumValues) throw new Error('Device observation value capacity');
    values.set(address, Object.freeze({ address, group: packet.group ?? null, channel: packet.channel ?? null, kind, index, value, wireBits, sourcePrecision: 'unknown', source: source(event), ...extra }));
  };
  const requireCategory = (field, bit) => { if (!(categories[field] & bit)) throw new Error('Unrequested or declined message in device report'); };
  return Object.freeze({
    accept(event) {
      const packet = event.packet;
      if (packet.group !== scope.group || scope.channel != null && packet.channel != null && packet.channel !== scope.channel) throw new Error('Report body outside the isolated group/channel');
      if (packet.kind === 'system') {
        const bit = { quarterFrame: 1, songPosition: 2, songSelect: 4 }[packet.status]; if (!bit) throw new Error('Nonstateful System message in report');
        requireCategory('system', bit);
        if (packet.status === 'quarterFrame') { const index = packet.data[0] >>> 4; quarterFrames.add(index); put(event, 'quarterFrame', index, packet.data[0], 7); }
        else put(event, packet.status, '', packet.status === 'songPosition' ? packet.data[0] + packet.data[1] * 128 : packet.data[0], packet.status === 'songPosition' ? 14 : 7);
        return;
      }
      if (!['midi1-channel-voice', 'midi2-channel-voice'].includes(packet.kind)) throw new Error('Unknown report body message');
      const midi2 = packet.protocol === 'midi2', data = packet.data, status = packet.status, bits = midi2 ? 32 : 7;
      const channelKey = packet.group + ':' + packet.channel; let state = channels.get(channelKey);
      if (!state) { state = { bankMSB: null, bankLSB: null, cc: new Map(), selector: null, registeredMSB: null, registeredLSB: null, assignableMSB: null, assignableLSB: null, dataMSB: null }; channels.set(channelKey, state); }
      if (status === 'pitchBend') { requireCategory('controllers', 1); put(event, 'pitchBend', '', midi2 ? packet.controllerValue.value : data[0] + data[1] * 128, midi2 ? 32 : 14); }
      else if (status === 'channelPressure') { requireCategory('controllers', 32); put(event, status, '', midi2 ? packet.controllerValue.value : data[0], bits); }
      else if (status === 'programChange') {
        requireCategory('controllers', 16);
        const bank = midi2 ? packet.bankValid ? Object.freeze({ known: true, msb: packet.bankMSB, lsb: packet.bankLSB }) : Object.freeze({ known: false }) :
          state.bankMSB != null && state.bankLSB != null ? Object.freeze({ known: false, observedMSB: state.bankMSB, observedLSB: state.bankLSB, receiverInterpretation: 'unverified-bank-pattern' }) : Object.freeze({ known: false, msb: state.bankMSB, lsb: state.bankLSB });
        put(event, status, '', midi2 ? packet.program : data[0], 7, { bank });
      } else if (['registeredController', 'assignableController'].includes(status)) {
        requireCategory('controllers', status === 'registeredController' ? 4 : 8); put(event, status, packet.bank * 128 + packet.index, packet.controllerValue.value, 32);
      } else if (['relativeRegisteredController', 'relativeAssignableController'].includes(status)) throw new Error('Relative changes cannot establish an absolute state baseline');
      else if (status === 'controlChange') {
        const controller = midi2 ? packet.controller : data[0], value = midi2 ? packet.controllerValue.value : data[1];
        if (!midi2 && [98, 99, 100, 101, 6, 38, 96, 97].includes(controller) && (categories.controllers & 12)) {
          if (controller === 96 || controller === 97) throw new Error('Nonstateful parameter increment in device report');
          if (controller === 101 || controller === 100) { requireCategory('controllers', 4); state.selector = 'registered'; state[controller === 101 ? 'registeredMSB' : 'registeredLSB'] = value; state.dataMSB = null; return; }
          if (controller === 99 || controller === 98) { requireCategory('controllers', 8); state.selector = 'assignable'; state[controller === 99 ? 'assignableMSB' : 'assignableLSB'] = value; state.dataMSB = null; return; }
          const prefix = state.selector, msb = prefix && state[prefix + 'MSB'], lsb = prefix && state[prefix + 'LSB'];
          if (!prefix || msb == null || lsb == null || msb === 127 && lsb === 127) throw new Error('Parameter data without a complete selector');
          requireCategory('controllers', prefix === 'registered' ? 4 : 8);
          if (controller === 6) { state.dataMSB = value; put(event, prefix + 'Controller', msb * 128 + lsb, value, 7, { lowBitsKnown: false }); }
          else { if (state.dataMSB == null) throw new Error('Parameter LSB without reported MSB'); put(event, prefix + 'Controller', msb * 128 + lsb, state.dataMSB * 128 + value, 14, { lowBitsKnown: true }); } return;
        }
        if (!midi2 && controller === 0 && (categories.controllers & 16)) { state.bankMSB = value; if (!(categories.controllers & 2)) return; }
        if (!midi2 && controller === 32 && (categories.controllers & 16)) { state.bankLSB = value; if (!(categories.controllers & 2)) return; }
        requireCategory('controllers', 2); put(event, status, controller, value, bits);
        if (!midi2) {
          state.cc.set(controller, value); const index = controller < 32 ? controller : controller < 64 ? controller - 32 : null;
          if (index != null && state.cc.has(index) && state.cc.has(index + 32)) put(event, 'controlChangePairCandidate', index, state.cc.get(index) * 128 + state.cc.get(index + 32), 14, { lowBitsKnown: true, baselineUsable: false });
        }
      } else {
        const bit = ['noteOn', 'noteOff'].includes(status) ? 1 : status === 'polyPressure' ? 2 : status === 'perNotePitchBend' ? 4 : status === 'registeredPerNoteController' ? 8 : status === 'assignablePerNoteController' ? 16 : 0;
        if (!bit) throw new Error('Unsupported stateful note report message'); requireCategory('notes', bit);
        const note = midi2 ? packet.note : data[0];
        const value = ['noteOn', 'noteOff'].includes(status) ? midi2 ? packet.velocity.value : data[1] : midi2 ? packet.controllerValue.value : data[1];
        put(event, bit === 1 ? 'note-state' : status, note + ':' + (packet.controller ?? ''), value, bit === 1 && midi2 ? 16 : bits, { reportStatus: packet.zeroVelocityNoteOff ? 'noteOff' : status, playable: false, baselineUsable: false });
      }
    },
    finish() { if ((categories.system & 1) && quarterFrames.size !== 8) throw new Error('Incomplete MTC quarter-frame report'); return Object.freeze([...values.values()]); }
  });
}
