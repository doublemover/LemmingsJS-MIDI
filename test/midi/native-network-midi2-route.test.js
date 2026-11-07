import { expect } from 'chai';
import { createNativeMidiRoutes } from '../../js/midi/native/NativeMidiRoutes.js';
import { inspectNativeEndpointTransport, OS_NETWORK_MIDI2_CONSENT } from '../../js/midi/native/NativeEndpointTransport.js';

const endpoint = { endpointToken: 11, name: 'Configured LAN synth', direction: 'output', groupMask: 1, transport: { source: 'windows-midi-services', id: '{C95DCD1F-CDE3-4C2D-913C-528CB8A4CBE6}', code: 'NET2UDP', sessionOwner: 'os' } };
describe('OS-managed Network MIDI 2 route admission', () => {
  it('requires the exact OS transport identity and retains unknown peer/link evidence', () => {
    const actual = inspectNativeEndpointTransport(endpoint);
    expect(actual).to.include({ kind: 'os-managed-network-midi2', standard: 'M2-124', applicationUdp: false, sessionOwner: 'os', peerAddress: null, roundTripMs: null, lossRate: null });
    expect(inspectNativeEndpointTransport({ name: 'Network MIDI 2', transport: { code: 'NETWORK_UMP' } }).kind).to.equal('unidentified-native-transport');
    expect(inspectNativeEndpointTransport({ ...endpoint, transport: { ...endpoint.transport, id: 'different-transport', code: 'OSC' } }).kind).to.equal('os-managed-native-transport');
  });
  it('refuses an unreviewed or authentication-required grant before opening the bridge device, then binds the reviewed OS evidence', async () => {
    let opens = 0;
    const client = { session: 7, state: 'connected', capabilities: {}, now: () => 0, subscribe: () => () => {},
      enumerate: async () => ({ inventoryEpoch: 9, endpoints: [endpoint] }),
      open: async () => { opens++; return { grant: 3, session: 7, connectionEpoch: 7, direction: 'output', groupMask: 1, permissions: 0, transport: endpoint.transport }; },
      closeGrant: async () => ({ kind: 'closed', grant: 3, session: 7, cleanupUnconfirmedNotes: 0, cleanupUnconfirmedControls: 0, nativeCloseConfirmed: true }),
      disconnect: async () => { client.state = 'disconnected'; } };
    const routes = createNativeMidiRoutes({ client });
    try {
      await routes.enumerate(); const request = { inventoryEpoch: 9, endpointToken: 11, groupMask: 1 };
      for (const options of [request, { ...request, networkConsent: OS_NETWORK_MIDI2_CONSENT, requiresAuthentication: true }]) {
        let failure; try { await routes.open(options); } catch (error) { failure = error; }
        expect(failure.message).to.include('explicitly'); expect(opens).to.equal(0);
      }
      const grant = await routes.open({ ...request, networkConsent: OS_NETWORK_MIDI2_CONSENT }); expect(opens).to.equal(1);
      expect(grant.transport).to.deep.equal(inspectNativeEndpointTransport(endpoint)); expect(grant.endpoint).to.equal(endpoint); expect(grant.connectionEpoch).to.equal(7);
    } finally { await routes.dispose(); }
  });
});
