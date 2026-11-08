import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createNativeMidiCodecCorpus } from './NativeMidiCodecCorpus.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const sourceFiles = ['native/midi-codec/dependencies.json', 'native/midi-codec/CMakeLists.txt', 'native/midi-codec/UmpBatchGuard.hpp', 'native/midi-codec/peer.cpp',
  'scripts/NativeMidiCodecCorpus.js', 'scripts/qualify-native-midi-codec.js', 'js/midi/protocol/UmpPacketCodec.js', 'js/midi/protocol/MidiProtocolLowering.js'];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const inventory = () => Promise.all(sourceFiles.map(async name => { const bytes = await fs.readFile(path.join(root, name)); return { path: name, bytes: bytes.length, sha256: sha256(bytes) }; }));
const execute = (command, args, options = {}) => {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', timeout: 600000, maxBuffer: 32 * 1024 * 1024, ...options });
  if (result.error || result.status !== 0) throw new Error(`${command} failed (${result.status ?? result.error?.code}):\n${String(result.stdout || '').slice(-8000)}\n${String(result.stderr || '').slice(-8000)}`);
  return result;
};

export async function qualifyNativeMidiCodec() {
  const output = path.join(root, '.tmp/native-midi-codec-qualification.json'); await fs.mkdir(path.dirname(output), { recursive: true });
  const build = path.join(root, 'node_modules/.cache/lemmings-native-midi', process.platform + '-' + process.arch);
  const receipt = { schema: 'lemmings-native-midi-codec-qualification/v1', status: 'failed', platform: process.platform, arch: process.arch, osRelease: os.release(),
    node: process.version, scope: 'codec-and-synchronous-controlled-raw-sender-only', deviceIO: false, shippingTransportQualified: false };
  try {
    receipt.source = await inventory(); receipt.dependencies = JSON.parse(await fs.readFile(path.join(root, sourceFiles[0]), 'utf8'));
    const compiler = process.env.CXX || (process.platform === 'win32' ? 'clang++' : 'c++');
    receipt.compiler = execute(compiler, ['--version']).stdout.trim(); receipt.cmake = execute('cmake', ['--version']).stdout.split('\n')[0];
    console.log('Configuring pinned native MIDI codec dependencies in the ignored dependency cache.');
    execute('cmake', ['-S', path.join(root, 'native/midi-codec'), '-B', build, '-G', 'Ninja', '-DCMAKE_BUILD_TYPE=Release', '-DCMAKE_CXX_COMPILER=' + compiler]);
    console.log('Building the application-owned peer and ni-midi2; native device transports remain disabled.');
    execute('cmake', ['--build', build, '--target', 'lemmings-midi-codec', '--parallel', '2']);
    const executable = path.join(build, 'lemmings-midi-codec' + (process.platform === 'win32' ? '.exe' : ''));
    const bytes = await fs.readFile(executable); receipt.executable = { bytes: bytes.length, sha256: sha256(bytes) };
    const cases = createNativeMidiCodecCorpus(receipt.dependencies), input = cases.map(item => item.line).join('\n') + '\n';
    const started = performance.now(), response = execute(executable, [], { input });
    receipt.peerProcessWallMs = performance.now() - started;
    const rows = response.stdout.trim().split('\n').map(line => JSON.parse(line)); assert.equal(rows.length, cases.length, 'exactly one receipt per corpus command');
    for (let at = 0; at < cases.length; at++) {
      try { cases[at].check(rows[at]); } catch (error) { throw new Error(`Native corpus case ${at}: ${cases[at].name}`, { cause: error }); }
    }
    receipt.corpus = { commands: cases.length, inputBytes: Buffer.byteLength(input), inputSha256: sha256(input), outputSha256: sha256(response.stdout), seed: '0x6d696469',
      seededWholeBatchCases: 2048, typedConstructorCases: cases.filter(item => item.name.startsWith('typed ')).length,
      scalingCases: cases.filter(item => item.line.startsWith('S ') && !item.name.startsWith('malformed')).length };
    receipt.widths = rows[1].rows;
    receipt.knownPeerLimits = { libremidiTypedFlexAndStreamWordCount: 0, cmidi2ReservedWidthsAreNotFramingAuthority: true,
      cmidi2LowNoteVelocitiesBecomeZero: true, niMidi1ParameterLoweringUnavailable: true };
    receipt.loweringProbes = rows.filter(row => row.kind === 'lower');
    const rejected = [];
    for (const [name, malformed] of [['line-capacity', 'x'.repeat(65537) + '\n'], ['embedded-nul', 'I\0\n'], ['carriage-return', 'I\r\n'], ['unterminated', 'I']]) {
      const result = spawnSync(executable, [], { input: malformed, encoding: 'utf8', timeout: 10000, maxBuffer: 4096 });
      assert.equal(result.status, 2, name); const row = JSON.parse(result.stdout); assert.equal(row.kind, 'error', name); rejected.push({ name, exitCode: result.status, reason: row.reason });
    }
    receipt.protocolRejections = rejected;
    for (const name of ['ni_midi2', 'cmidi2', 'libremidi']) {
      const directory = path.join(build, '_deps', name + '-src');
      assert.equal(execute('git', ['-C', directory, 'rev-parse', 'HEAD']).stdout.trim(), receipt.dependencies[name].revision);
      execute('git', ['-C', directory, 'diff', '--quiet', 'HEAD']);
      assert.equal(execute('git', ['-C', directory, 'ls-files', '--others', '--exclude-standard']).stdout.trim(), '');
    }
    assert.deepEqual(await inventory(), receipt.source, 'qualification source stayed immutable during build and execution');
    receipt.status = 'passed'; console.log(`Native MIDI codec qualification passed ${cases.length} commands and four bounded protocol failures.`);
  } catch (error) {
    receipt.error = String(error.stack || error); if (error.cause) receipt.cause = String(error.cause.stack || error.cause);
    console.error(receipt.error, receipt.cause || '');
  } finally { await fs.writeFile(output, JSON.stringify(receipt, null, 2) + '\n'); }
  return receipt.status === 'passed' ? 0 : 1;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) process.exitCode = await qualifyNativeMidiCodec();
