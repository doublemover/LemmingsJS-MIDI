export const NETWORK_MIDI2_TRANSPORT_SOURCE = 'https://github.com/microsoft/MIDI/blob/d3947a3c3732108b0475b14054f93a078dc3c7d5/src/in-box/Transport/UdpNetworkMidi2Transport/net2udp_transport_defs.h';
export const OS_NETWORK_MIDI2_CONSENT = 'reviewed-os-managed-network-session-with-unverified-authentication';
const NETWORK_ID = 'c95dcd1f-cde3-4c2d-913c-528cb8a4cbe6';
export function inspectNativeEndpointTransport(endpoint) {
  const value = endpoint?.transport;
  if (value?.source !== 'windows-midi-services' || value.sessionOwner !== 'os' || typeof value.id !== 'string' || value.id.length > 128 || typeof value.code !== 'string' || value.code.length > 64 || /[\x00-\x1f\x7f]/.test(value.id + value.code)) return Object.freeze({ kind: 'unidentified-native-transport', evidence: 'no-verified-os-transport-identity', sessionOwner: 'unknown' });
  const id = value.id.replace(/^\{(.+)\}$/, '$1').toLowerCase(), network = id === NETWORK_ID && value.code === 'NET2UDP';
  return Object.freeze({ kind: network ? 'os-managed-network-midi2' : 'os-managed-native-transport', id, code: value.code, sessionOwner: 'os', evidence: 'windows-midi-services-transport-supplied-identity',
    ...(network ? { standard: 'M2-124', applicationUdp: false, authentication: 'unverified-by-pinned-endpoint-api', encryption: 'unverified', sessionApproval: 'external-os-setup-required', peerAddress: null, roundTripMs: null, lossRate: null, reconnect: 'OS-session-policy;new-app-grant-and-current-endpoint-negotiation-required', qualification: 'independent-peer-and-wired-wifi-timing-pending' } : {}) });
}
export function assertNativeTransportGrant(endpoint, options = {}) {
  const transport = inspectNativeEndpointTransport(endpoint);
  if (transport.kind === 'os-managed-network-midi2' && (options.networkConsent !== OS_NETWORK_MIDI2_CONSENT || options.requiresAuthentication === true)) throw new Error('Review and approve this OS-managed Network MIDI 2 session explicitly. This pinned endpoint adapter cannot verify password authentication or encryption; an authentication-required route is unavailable.');
  return transport;
}
