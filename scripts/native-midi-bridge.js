import fs from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { nativeMidiExecutable } from './build-native-midi-companion.js';
import { createNativeMidiBridgeServer } from './native-midi/NativeMidiBridgeServer.js';

const option = name => process.argv.find(value => value.startsWith('--' + name + '='))?.slice(name.length + 3);
const cert = option('cert'), key = option('key');
if (!!cert !== !!key) throw new Error('Supply both --cert and --key for WSS');
const bridge = await createNativeMidiBridgeServer({ executable: option('executable') || nativeMidiExecutable, port: Number(option('port') || 8765),
  origins: option('origins')?.split(',') || ['http://127.0.0.1:8080', 'http://localhost:8080'],
  tls: cert ? { cert: await fs.readFile(cert), key: await fs.readFile(key) } : null });
console.log('Native MIDI bridge: ' + bridge.url);
console.log('Pairing code (expires in two minutes; enter only in your application): ' + bridge.issuePairingCode());
console.log('Local commands: pair — issue a new code; revoke — close all endpoint grants; quit — stop.');
const input = createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
let stopping = false;
const stop = async () => { if (stopping) return; stopping = true; input.close(); await bridge.close(); };
input.on('line', line => {
  if (line.trim() === 'pair') console.log('Pairing code: ' + bridge.issuePairingCode());
  else if (line.trim() === 'revoke') { bridge.revokeAll(); console.log('All application endpoint grants revoked.'); }
  else if (line.trim() === 'quit') stop().catch(error => { console.error(error.message); process.exitCode = 1; });
});
process.on('SIGINT', () => { stop().catch(() => { process.exitCode = 1; }); });
process.on('SIGTERM', () => { stop().catch(() => { process.exitCode = 1; }); });
