import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { StringDecoder } from 'node:string_decoder';
import { NATIVE_MIDI_BRIDGE_PROTOCOL } from '../../js/midi/native/NativeMidiBridgeProtocol.js';

export class NativeMidiProcess extends EventEmitter {
  #child = null; #pending = new Map(); #sequence = 0; #buffer = ''; #decoder = new StringDecoder('utf8'); #closed = false;
  constructor({ executable, now = () => performance.now() } = {}) { super(); this.executable = executable; this.now = now; this.ready = null; }
  start() {
    if (this.#child || this.#closed) throw new Error('Native MIDI process already used');
    const child = this.#child = spawn(this.executable, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false });
    child.on('error', error => this.#fail(error.code === 'ENOENT' ? 'not-installed' : 'native-process-error'));
    child.on('exit', () => this.#fail('native-process-exited'));
    child.stdin.on('error', () => this.#fail('native-input-closed'));
    child.stderr.on('data', () => {}); // Native diagnostics never relay endpoint names or credentials into server logs.
    child.stdout.on('data', chunk => {
      try {
        this.#buffer += this.#decoder.write(chunk);
        let newline;
        while ((newline = this.#buffer.indexOf('\n')) >= 0) {
          if (newline > 65536) throw new Error('Native output capacity');
          const line = this.#buffer.slice(0, newline); this.#buffer = this.#buffer.slice(newline + 1); const row = JSON.parse(line);
          if (row.event === 'ready') {
            if (this.ready || row.protocol !== NATIVE_MIDI_BRIDGE_PROTOCOL) throw new Error('Native protocol mismatch');
            this.ready = Object.freeze(row); this.emit('ready', this.ready);
          } else if (row.event === 'receipt') {
            const pending = this.#pending.get(row.requestId);
            if (!pending) continue;
            if (row.session !== pending.session) throw new Error('Native session mismatch');
            if (row.kind === 'queued') { pending.onQueued?.(row); continue; }
            this.#pending.delete(row.requestId); clearTimeout(pending.timeout); pending.resolve(Object.freeze(row));
          } else this.emit('notification', row);
        }
        if (this.#buffer.length > 65536) throw new Error('Native output capacity');
      } catch { this.#fail('native-protocol-failed'); }
    });
    return this;
  }
  request(operation, session, fields = [], { priority = false, onQueued } = {}) {
    if (!this.ready || this.#closed || !/^[SHPLAOVBCXDQKYRT]$/.test(operation) || !Number.isSafeInteger(session) || session < 0 || session > 0xffffffff ||
        this.#sequence >= 0xffffffff || this.#pending.size >= (priority ? 512 : 480)) return Promise.reject(Object.assign(new Error('Native peer unavailable or at capacity'), { notSubmitted: true }));
    if (fields.some(value => typeof value !== 'string' && !Number.isSafeInteger(value) || String(value).includes('\n') || String(value).includes('\r') || String(value).includes('\0'))) return Promise.reject(Object.assign(new Error('Invalid native command field'), { notSubmitted: true }));
    const requestId = ++this.#sequence, line = [operation, requestId, session, ...fields].join(' ') + '\n';
    if (Buffer.byteLength(line) > 65537 || this.#child.stdin.writableLength + Buffer.byteLength(line) > (priority ? 1048576 : 983040)) return Promise.reject(Object.assign(new Error('Native input pressure'), { notSubmitted: true }));
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => this.#fail('native-request-timeout'), 10000); timeout.unref?.();
      this.#pending.set(requestId, { session, resolve, reject, timeout, onQueued });
      this.#child.stdin.write(line);
    });
  }
  #fail(reason) {
    if (this.#closed) return; this.#closed = true;
    for (const pending of this.#pending.values()) { clearTimeout(pending.timeout); pending.reject(new Error(reason)); } this.#pending.clear();
    this.#child?.stdin.end();
    const child = this.#child; if (child && child.exitCode === null) { const timeout = setTimeout(() => child.kill(), 2000); timeout.unref?.(); child.once('exit', () => clearTimeout(timeout)); }
    this.emit('unavailable', { state: reason, queuedWorkReplayed: false });
  }
  async close() {
    if (this.#closed) return;
    try { await this.request('Q', 0, [], { priority: true }); } catch {}
    this.#fail('closed');
  }
}
